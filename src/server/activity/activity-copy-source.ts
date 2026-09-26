import "server-only";
import { z } from "zod";
import { activityContentV3Schema } from "../../domain/activity/activity-content";
import type { Prisma } from "../../generated/prisma/client";

export const activityCopySourceSchema = z.object({
  kind: z.enum(["DRAFT", "RELEASE"]),
  id: z.uuid(),
  version: z.int().positive(),
}).strict();
export type ActivityCopySource = z.infer<typeof activityCopySourceSchema>;

export class ActivityCopyError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "STALE_VERSION" | "UNSUPPORTED_SCHEMA" | "IDEMPOTENCY_MISMATCH" | "CONCURRENT_WRITE") {
    super(code);
    this.name = "ActivityCopyError";
  }
}

/** Shared by preview and write. Locks keep account/school and ownership checks
 * valid until the transaction completes, including an idempotent replay. */
export async function requireCopyTeacher(tx: Prisma.TransactionClient, actorId: string) {
  const rows = await tx.$queryRaw<Array<{ display_name: string }>>`
    SELECT u.display_name FROM app_users u JOIN schools s ON s.id = u.school_id
    WHERE u.id = ${actorId}::uuid AND u.role = 'TEACHER'
      AND u.account_status = 'ACTIVE' AND s.status = 'ACTIVE'
    FOR SHARE OF u, s`;
  if (!rows[0]) throw new ActivityCopyError("NOT_FOUND");
  return { displayName: rows[0].display_name };
}

export async function readActivityCopySource(
  tx: Prisma.TransactionClient,
  actorId: string,
  source: ActivityCopySource,
  options: { replay?: boolean } = {},
) {
  if (source.kind === "DRAFT") {
    const owned = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM activity_drafts WHERE id = ${source.id}::uuid
        AND owner_id = ${actorId}::uuid FOR SHARE`;
    if (!owned[0]) throw new ActivityCopyError("NOT_FOUND");
    const draft = await tx.activityDraft.findUniqueOrThrow({ where: { id: source.id } });
    // Sealed sources must use the release path, where classroom authority is
    // checked. This prevents bypassing revoked release access via its draft.
    if (draft.status === "SEALED") throw new ActivityCopyError("NOT_FOUND");
    if (!options.replay && draft.version !== source.version) throw new ActivityCopyError("STALE_VERSION");
    const revision = await tx.activityDraftRevision.findUnique({
      where: { draftId_version: { draftId: source.id, version: source.version } },
    });
    if (!revision) throw new ActivityCopyError("NOT_FOUND");
    if (revision.schemaVersion !== 3) throw new ActivityCopyError("UNSUPPORTED_SCHEMA");
    return {
      source,
      content: activityContentV3Schema.parse(revision.taskBook),
      sourceRevisionId: revision.id,
      sourceReleaseId: null,
    };
  }
  const owned = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT r.id FROM activity_releases r JOIN classrooms c ON c.id = r.classroom_id
    WHERE r.id = ${source.id}::uuid AND r.publisher_id = ${actorId}::uuid
      AND c.manager_id = ${actorId}::uuid FOR SHARE OF r, c`;
  if (!owned[0]) throw new ActivityCopyError("NOT_FOUND");
  const snapshot = await tx.activityReleaseSnapshot.findUnique({ where: { releaseId: source.id } });
  if (!snapshot) throw new ActivityCopyError("NOT_FOUND");
  if (snapshot.sourceDraftVersion !== source.version) throw new ActivityCopyError("STALE_VERSION");
  if (snapshot.schemaVersion !== 3) throw new ActivityCopyError("UNSUPPORTED_SCHEMA");
  return {
    source,
    content: activityContentV3Schema.parse(snapshot.content),
    sourceRevisionId: null,
    sourceReleaseId: snapshot.releaseId,
  };
}
