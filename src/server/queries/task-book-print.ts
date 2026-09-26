import "server-only";

import { z } from "zod";
import {
  activityContentV3Schema,
  type ActivityContentV3,
} from "../../domain/activity/activity-content";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import { getTeacherIdentity } from "./teacher-activity-workspace";

export class TaskBookPrintError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "UNSUPPORTED_SCHEMA") {
    super(code);
    this.name = "TaskBookPrintError";
  }
}

export type PrintableTaskBook = Readonly<{
  kind: "DRAFT" | "RELEASE";
  content: ActivityContentV3;
  /** Draft revision version, or the draft version the release froze. */
  version: number;
  /** When that revision was saved, or when the release was published. */
  datedAt: string;
  classroomName: string | null;
  dueAt: string | null;
}>;

/**
 * One exact saved revision of the teacher's own draft (D-071). Revisions are
 * immutable, so the printout is always that version, never the live form.
 */
export async function getPrintableDraftRevision(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: { draftId: string; version?: number },
): Promise<PrintableTaskBook> {
  const input = z
    .object({ draftId: z.uuid(), version: z.int().positive().optional() })
    .strict()
    .parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  await getTeacherIdentity(database, commandContext, {});

  const draft = await database.activityDraft.findUnique({
    where: { id: input.draftId },
    select: {
      ownerId: true,
      version: true,
      revisions: {
        where: { version: input.version ?? undefined },
        orderBy: { version: "desc" },
        take: 1,
        select: { version: true, schemaVersion: true, taskBook: true, createdAt: true },
      },
    },
  });
  if (!draft || draft.ownerId !== context.actorId) {
    throw new TaskBookPrintError("NOT_FOUND");
  }
  const revision = draft.revisions[0];
  if (!revision) throw new TaskBookPrintError("NOT_FOUND");
  if (revision.schemaVersion !== 3) {
    throw new TaskBookPrintError("UNSUPPORTED_SCHEMA");
  }
  return {
    kind: "DRAFT",
    content: activityContentV3Schema.parse(revision.taskBook),
    version: revision.version,
    datedAt: revision.createdAt.toISOString(),
    classroomName: null,
    dueAt: null,
  };
}

/**
 * The frozen snapshot of a release, for its publisher while they still manage
 * the class — the same boundary as the release roster. Later edits or copies
 * of the source draft never reach this printout.
 */
export async function getPrintableRelease(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: { releaseId: string },
): Promise<PrintableTaskBook> {
  const input = z.object({ releaseId: z.uuid() }).strict().parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  await getTeacherIdentity(database, commandContext, {});

  const release = await database.activityRelease.findUnique({
    where: { id: input.releaseId },
    select: {
      publisherId: true,
      publishedAt: true,
      dueAt: true,
      classroom: { select: { managerId: true, name: true } },
      snapshot: {
        select: { schemaVersion: true, content: true, sourceDraftVersion: true },
      },
    },
  });
  if (
    !release ||
    !release.snapshot ||
    release.publisherId !== context.actorId ||
    release.classroom.managerId !== context.actorId
  ) {
    throw new TaskBookPrintError("NOT_FOUND");
  }
  if (release.snapshot.schemaVersion !== 3) {
    throw new TaskBookPrintError("UNSUPPORTED_SCHEMA");
  }
  return {
    kind: "RELEASE",
    content: activityContentV3Schema.parse(release.snapshot.content),
    version: release.snapshot.sourceDraftVersion,
    datedAt: release.publishedAt.toISOString(),
    classroomName: release.classroom.name,
    dueAt: release.dueAt?.toISOString() ?? null,
  };
}
