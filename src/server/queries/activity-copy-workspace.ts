import "server-only";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { activityCopySourceSchema, ActivityCopyError, readActivityCopySource, requireCopyTeacher } from "../activity/activity-copy-source";
import { resolveCommandContext, type CommandContext } from "../commands/command-context";

export async function getActivityCopyPreview(database: PrismaClient, commandContext: CommandContext, rawInput: unknown) {
  const source = activityCopySourceSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  return database.$transaction(async (tx) => {
    const actor = await requireCopyTeacher(tx, context.actorId);
    return { actor, ...(await readActivityCopySource(tx, context.actorId, source)) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function getActivityCopySources(database: PrismaClient, commandContext: CommandContext) {
  const context = resolveCommandContext(commandContext, ["UI"]);
  return database.$transaction(async (tx) => {
    const actor = await requireCopyTeacher(tx, context.actorId);
    const drafts = await tx.activityDraft.findMany({
      where: { ownerId: context.actorId, schemaVersion: 3, status: { not: "SEALED" } },
      select: { id: true, title: true, version: true }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    const snapshots = await tx.activityReleaseSnapshot.findMany({
      where: { schemaVersion: 3, release: { publisherId: context.actorId, classroom: { managerId: context.actorId } } },
      select: { releaseId: true, sourceDraftVersion: true, sourceRevision: { select: { title: true } }, release: { select: { publishedAt: true, classroom: { select: { name: true } } } } },
      orderBy: [{ createdAt: "desc" }, { releaseId: "asc" }],
    });
    return { actor, drafts, releases: snapshots.map((s) => ({ id: s.releaseId, title: s.sourceRevision.title, version: s.sourceDraftVersion, classroomName: s.release.classroom.name, publishedAt: s.release.publishedAt.toISOString() })) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** Metadata belongs to the owned copy; it does not grant access to source
 * content if the original release's classroom authority has since changed. */
export async function getActivityDraftOrigin(database: PrismaClient, commandContext: CommandContext, draftId: string) {
  z.uuid().parse(draftId);
  const context = resolveCommandContext(commandContext, ["UI"]);
  return database.$transaction(async (tx) => {
    await requireCopyTeacher(tx, context.actorId);
    const draft = await tx.activityDraft.findFirst({ where: { id: draftId, ownerId: context.actorId }, select: { origin: { include: { sourceRevision: { select: { title: true, version: true } }, sourceSnapshot: { select: { sourceDraftVersion: true, sourceRevision: { select: { title: true } } } } } } } });
    if (!draft) throw new ActivityCopyError("NOT_FOUND");
    const origin = draft.origin;
    if (!origin) return null;
    return origin.sourceRevision
      ? { kind: "DRAFT" as const, title: origin.sourceRevision.title, version: origin.sourceRevision.version }
      : { kind: "RELEASE" as const, title: origin.sourceSnapshot!.sourceRevision.title, version: origin.sourceSnapshot!.sourceDraftVersion };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
