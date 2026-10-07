import "server-only";

import {
  activityContentV3WorkingSchema,
  type ActivityContentV3,
} from "../../domain/activity/activity-content";
import { describeTaskBookGaps } from "../../domain/activity/task-book-gaps";
import type { PrismaClient } from "../../generated/prisma/client";
import { resolveCommandContext, type CommandContext } from "../commands/command-context";

export type TaskBookWorkingCopy = Readonly<{
  id: string;
  draftId: string | null;
  baseVersion: number;
  version: number;
  content: ActivityContentV3;
  savedAt: string;
}>;

export type TaskBookWorkingCopySummary = Readonly<{
  id: string;
  draftId: string | null;
  title: string;
  savedAt: string;
  gapCount: number;
}>;

type Row = {
  id: string;
  draftId: string | null;
  baseVersion: number;
  version: number;
  content: unknown;
  updatedAt: Date;
};

/** A copy whose content no longer fits the task-book shape is not offered back. */
function toWorkingCopy(row: Row | null): TaskBookWorkingCopy | null {
  if (!row) return null;
  const parsed = activityContentV3WorkingSchema.safeParse(row.content);
  if (!parsed.success) return null;
  return {
    id: row.id,
    draftId: row.draftId,
    baseVersion: row.baseVersion,
    version: row.version,
    content: parsed.data as ActivityContentV3,
    savedAt: row.updatedAt.toISOString(),
  };
}

const columns = {
  id: true,
  draftId: true,
  baseVersion: true,
  version: true,
  content: true,
  updatedAt: true,
} as const;

/** A new task book's working copy, only for its owner. */
export async function getOwnNewTaskBookWorkingCopy(
  database: PrismaClient,
  commandContext: CommandContext,
  workingCopyId: string,
): Promise<TaskBookWorkingCopy | null> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const row = await database.activityDraftWorkingCopy.findFirst({
    where: { id: workingCopyId, ownerId: context.actorId, draftId: null },
    select: columns,
  });
  return toWorkingCopy(row);
}

/** The working copy of one of the teacher's own drafts, if any. */
export async function getOwnDraftWorkingCopy(
  database: PrismaClient,
  commandContext: CommandContext,
  draftId: string,
): Promise<TaskBookWorkingCopy | null> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const row = await database.activityDraftWorkingCopy.findFirst({
    where: { draftId, ownerId: context.actorId },
    select: columns,
  });
  return toWorkingCopy(row);
}

/** Everything the teacher has left unsaved, newest first, for the drafts list. */
export async function listOwnTaskBookWorkingCopies(
  database: PrismaClient,
  commandContext: CommandContext,
): Promise<TaskBookWorkingCopySummary[]> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const rows = await database.activityDraftWorkingCopy.findMany({
    where: { ownerId: context.actorId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { ...columns, title: true },
    take: 50,
  });
  return rows.flatMap((row) => {
    const copy = toWorkingCopy(row);
    if (!copy) return [];
    return [
      {
        id: copy.id,
        draftId: copy.draftId,
        title: row.title,
        savedAt: copy.savedAt,
        gapCount: describeTaskBookGaps(copy.content).length,
      },
    ];
  });
}
