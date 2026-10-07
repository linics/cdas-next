import "server-only";

import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  activityContentV3WorkingSchema,
  type ActivityContentV3,
} from "../../domain/activity/activity-content";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { isActiveSchoolMember } from "../school/teacher-authorization";
import { resolveCommandContext, type CommandContext } from "./command-context";
import {
  isSerializationFailure,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";

/**
 * D-093: a teacher's task book is autosaved here while it is incomplete. This
 * is scratch paper, not history: it is overwritten in place, writes no audit
 * row, and nothing downstream (preview, publish, copy, the assistant's tools,
 * version checks) ever reads it. Saving a complete version still goes through
 * `saveActivityDraft` and its full schema; that is where the record lives.
 *
 * Concurrency is by version: a stale tab cannot overwrite a newer copy. A
 * retried autosave whose content is already stored counts as saved, so a
 * response lost in transit does not turn into a conflict.
 */

const MAX_CONTENT_CHARS = 200_000;

const saveInputSchema = z
  .object({
    workingCopyId: z.uuid().nullable(),
    draftId: z.uuid().nullable(),
    expectedVersion: z.int().positive().nullable(),
    content: z.unknown(),
  })
  .strict();

const discardInputSchema = z
  .object({
    workingCopyId: z.uuid(),
    expectedVersion: z.int().positive().nullable(),
  })
  .strict();

export type SaveActivityDraftWorkingCopyInput = z.input<typeof saveInputSchema>;

export type ActivityDraftWorkingCopyResult = Readonly<{
  workingCopyId: string;
  draftId: string | null;
  version: number;
  savedAt: string;
}>;

export class ActivityDraftWorkingCopyError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "DRAFT_SEALED"
      | "STALE_VERSION"
      | "INVALID_CONTENT"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "ActivityDraftWorkingCopyError";
  }
}

async function requireTeacher(
  transaction: Prisma.TransactionClient,
  actorId: string,
): Promise<void> {
  if (!(await isActiveSchoolMember(transaction, actorId))) {
    throw new ActivityDraftWorkingCopyError("NOT_FOUND");
  }
  const actor = await transaction.appUser.findUnique({
    where: { id: actorId },
    select: { role: true },
  });
  if (!actor) throw new ActivityDraftWorkingCopyError("NOT_FOUND");
  if (actor.role !== "TEACHER") throw new ActivityDraftWorkingCopyError("FORBIDDEN");
}

function parseContent(raw: unknown): ActivityContentV3 {
  const parsed = activityContentV3WorkingSchema.safeParse(raw);
  if (!parsed.success || JSON.stringify(parsed.data).length > MAX_CONTENT_CHARS) {
    throw new ActivityDraftWorkingCopyError("INVALID_CONTENT");
  }
  return parsed.data as ActivityContentV3;
}

function result(row: {
  id: string;
  draftId: string | null;
  version: number;
  updatedAt: Date;
}): ActivityDraftWorkingCopyResult {
  return {
    workingCopyId: row.id,
    draftId: row.draftId,
    version: row.version,
    savedAt: row.updatedAt.toISOString(),
  };
}

async function serializable<T>(
  database: PrismaClient,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      });
    } catch (error) {
      if (isSerializationFailure(error) && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      if (isSerializationFailure(error)) {
        throw new ActivityDraftWorkingCopyError("CONCURRENT_WRITE");
      }
      throw error;
    }
  }
}

export async function saveActivityDraftWorkingCopy(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SaveActivityDraftWorkingCopyInput,
): Promise<ActivityDraftWorkingCopyResult> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const input = saveInputSchema.parse(rawInput);
  const content = parseContent(input.content);
  const title = content.title.trim().slice(0, 120);
  const columns = {
    content: content as Prisma.InputJsonValue,
    title,
    updatedAt: context.now,
  };

  return serializable(database, async (transaction) => {
    await requireTeacher(transaction, context.actorId);

    if (input.draftId) {
      const draft = await transaction.activityDraft.findUnique({
        where: { id: input.draftId },
        select: { ownerId: true, status: true, version: true },
      });
      if (!draft || draft.ownerId !== context.actorId) {
        throw new ActivityDraftWorkingCopyError("NOT_FOUND");
      }
      if (draft.status === "SEALED") {
        throw new ActivityDraftWorkingCopyError("DRAFT_SEALED");
      }
      const existing = await transaction.activityDraftWorkingCopy.findUnique({
        where: { draftId: input.draftId },
      });
      if (!existing) {
        if (input.workingCopyId) {
          // The copy this tab knew about was saved into a version or thrown
          // away elsewhere; starting a fresh one would resurrect it silently.
          throw new ActivityDraftWorkingCopyError("STALE_VERSION");
        }
        return result(
          await transaction.activityDraftWorkingCopy.create({
            data: {
              ownerId: context.actorId,
              draftId: input.draftId,
              baseVersion: draft.version,
              ...columns,
              createdAt: context.now,
            },
          }),
        );
      }
      return update(transaction, existing, input, columns);
    }

    if (!input.workingCopyId) {
      return result(
        await transaction.activityDraftWorkingCopy.create({
          data: {
            ownerId: context.actorId,
            draftId: null,
            baseVersion: 0,
            ...columns,
            createdAt: context.now,
          },
        }),
      );
    }
    const existing = await transaction.activityDraftWorkingCopy.findUnique({
      where: { id: input.workingCopyId },
    });
    if (!existing || existing.ownerId !== context.actorId || existing.draftId !== null) {
      throw new ActivityDraftWorkingCopyError("NOT_FOUND");
    }
    return update(transaction, existing, input, columns);
  });
}

async function update(
  transaction: Prisma.TransactionClient,
  existing: {
    id: string;
    ownerId: string;
    draftId: string | null;
    version: number;
    content: Prisma.JsonValue;
    updatedAt: Date;
  },
  input: z.infer<typeof saveInputSchema>,
  columns: { content: Prisma.InputJsonValue; title: string; updatedAt: Date },
): Promise<ActivityDraftWorkingCopyResult> {
  if (input.workingCopyId !== null && input.workingCopyId !== existing.id) {
    throw new ActivityDraftWorkingCopyError("NOT_FOUND");
  }
  if (existing.version !== input.expectedVersion) {
    if (isDeepStrictEqual(existing.content, columns.content)) return result(existing);
    throw new ActivityDraftWorkingCopyError("STALE_VERSION");
  }
  return result(
    await transaction.activityDraftWorkingCopy.update({
      where: { id: existing.id },
      data: { ...columns, version: existing.version + 1 },
    }),
  );
}

/**
 * Throws the copy away: the teacher chose the saved version instead, or a
 * complete version was just saved from it. `expectedVersion` null discards
 * whatever is there; a number discards only that copy, so a save cannot drop
 * edits another tab made after it.
 */
export async function discardActivityDraftWorkingCopy(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: z.input<typeof discardInputSchema>,
): Promise<{ discarded: boolean }> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const input = discardInputSchema.parse(rawInput);
  return serializable(database, async (transaction) => {
    await requireTeacher(transaction, context.actorId);
    const existing = await transaction.activityDraftWorkingCopy.findUnique({
      where: { id: input.workingCopyId },
      select: { ownerId: true, version: true },
    });
    if (!existing || existing.ownerId !== context.actorId) {
      throw new ActivityDraftWorkingCopyError("NOT_FOUND");
    }
    if (input.expectedVersion !== null && existing.version !== input.expectedVersion) {
      return { discarded: false };
    }
    await transaction.activityDraftWorkingCopy.delete({ where: { id: input.workingCopyId } });
    return { discarded: true };
  });
}
