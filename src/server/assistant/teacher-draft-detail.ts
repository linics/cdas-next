import "server-only";

import { z } from "zod";
import { activityContentStructuredSchema } from "../../domain/activity/activity-content";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import {
  getTeacherActivityDraft,
  TeacherActivityQueryError,
  type TeacherActivityDashboard,
} from "../queries/teacher-activity-workspace";

const draftEditHrefSchema = z
  .string()
  .regex(/^\/teacher\/activities\/[0-9a-f-]{36}$/);
const draftPreviewHrefSchema = z
  .string()
  .regex(/^\/teacher\/activities\/[0-9a-f-]{36}\/preview$/);

/**
 * A draft the teacher owns is returned as the exact current v2 task book, so
 * the assistant reasons about the same words the teacher edits. Legacy v1
 * snapshots are named but never expanded: their shape predates the design
 * method the assistant is instructed with, and D-044 already refused to draft
 * against them. Anything else is resource-level absent.
 */
export const teacherDraftDetailOutputSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("FOUND"),
      draftId: z.uuid(),
      draftStatus: z.enum(["EDITING", "READY_FOR_PREVIEW", "SEALED"]),
      version: z.int().positive(),
      updatedAt: z.iso.datetime({ offset: true }),
      published: z.boolean(),
      editHref: draftEditHrefSchema,
      previewHref: draftPreviewHrefSchema,
      content: activityContentStructuredSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("LEGACY_SNAPSHOT"),
      draftId: z.uuid(),
      title: z.string().trim().min(1),
      editHref: draftEditHrefSchema,
      previewHref: draftPreviewHrefSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("NOT_FOUND"),
      draftId: z.uuid(),
    })
    .strict(),
]);

export type TeacherDraftDetailOutput = z.infer<
  typeof teacherDraftDetailOutputSchema
>;

export type TeacherDraftDetailReader = (
  draftId: string,
) => Promise<TeacherDraftDetailOutput>;

export type TeacherDraftDetailDependencies = Readonly<{
  database: PrismaClient;
  agentContext: CommandContext;
  workspace: TeacherActivityDashboard;
  getDraft?: typeof getTeacherActivityDraft;
}>;

/**
 * Reads are memoized per request. The same draft can be quoted by several
 * history parts and by a fresh tool call in one turn; they must all agree with
 * a single authorization decision, and one decision is also one query.
 */
export function createTeacherDraftDetailReader({
  database,
  agentContext,
  workspace,
  getDraft = getTeacherActivityDraft,
}: TeacherDraftDetailDependencies): TeacherDraftDetailReader {
  const pending = new Map<string, Promise<TeacherDraftDetailOutput>>();

  const read = async (draftId: string): Promise<TeacherDraftDetailOutput> => {
    const absent = teacherDraftDetailOutputSchema.parse({
      status: "NOT_FOUND",
      draftId,
    });
    // The already-authorized workspace is the outer gate. A draft owned by
    // another teacher, or a fabricated identifier, therefore never reaches the
    // database and cannot be distinguished from one that does not exist.
    if (!workspace.drafts.some((draft) => draft.id === draftId)) {
      return absent;
    }

    let draft;
    try {
      ({ draft } = await getDraft(database, agentContext, { draftId }));
    } catch (error) {
      if (error instanceof TeacherActivityQueryError) {
        return absent;
      }
      throw error;
    }

    const editHref = `/teacher/activities/${draft.id}`;
    const previewHref = `/teacher/activities/${draft.id}/preview`;
    // v1 predates the structured task book, so the assistant can only point
    // at it; v2 and v3 are both readable and revisable.
    if (draft.revision.content.schemaVersion === 1) {
      return teacherDraftDetailOutputSchema.parse({
        status: "LEGACY_SNAPSHOT",
        draftId: draft.id,
        title: draft.revision.content.title,
        editHref,
        previewHref,
      });
    }

    return teacherDraftDetailOutputSchema.parse({
      status: "FOUND",
      draftId: draft.id,
      draftStatus: draft.status,
      version: draft.version,
      updatedAt: draft.updatedAt,
      published: draft.releaseId !== null,
      editHref,
      previewHref,
      content: draft.revision.content,
    });
  };

  return (draftId: string) => {
    const existing = pending.get(draftId);
    if (existing) return existing;
    const result = read(draftId);
    pending.set(draftId, result);
    return result;
  };
}
