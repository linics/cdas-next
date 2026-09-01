import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  assertActiveBusinessActor,
  SchoolMemberAuthorizationError,
} from "../school/teacher-authorization";

const inputSchema = z.object({
  classroomId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

const resultSchema = z.object({
  classroomId: z.uuid(),
  deletedAt: z.iso.datetime({ offset: true }),
}).strict();

export type DeleteClassroomInput = z.input<typeof inputSchema>;
export type DeleteClassroomResult = z.infer<typeof resultSchema>;

export class DeleteClassroomError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "ACCOUNT_DISABLED"
      | "SCHOOL_DISABLED"
      | "NOT_FOUND"
      | "NOT_EMPTY"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "DeleteClassroomError";
  }
}

const commandName = "delete_empty_classroom";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Classroom deletion input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof inputSchema>,
  requestHash: string,
): Promise<DeleteClassroomResult> {
  return database.$transaction(async (transaction) => {
    const existingRecord = await transaction.idempotencyRecord.findUnique({
      where: {
        actorId_commandName_idempotencyKey: {
          actorId: context.actorId,
          commandName,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingRecord) {
      if (existingRecord.requestHash !== requestHash) {
        throw new DeleteClassroomError("IDEMPOTENCY_MISMATCH");
      }
      return resultSchema.parse(existingRecord.response);
    }

    const actor = await transaction.appUser.findUnique({
      where: { id: context.actorId },
      select: {
        role: true,
        accountStatus: true,
        schoolId: true,
        school: { select: { status: true } },
      },
    });
    assertActiveBusinessActor(actor);
    if (!actor || actor.role !== "TEACHER" || !actor.schoolId) {
      throw new DeleteClassroomError("FORBIDDEN");
    }

    const classroom = await transaction.classroom.findFirst({
      where: {
        id: input.classroomId,
        managerId: context.actorId,
        schoolId: actor.schoolId,
      },
      select: {
        id: true,
        _count: { select: { memberships: true, releases: true } },
      },
    });
    if (!classroom) throw new DeleteClassroomError("NOT_FOUND");
    if (classroom._count.memberships > 0 || classroom._count.releases > 0) {
      throw new DeleteClassroomError("NOT_EMPTY");
    }

    await transaction.classroom.delete({ where: { id: classroom.id } });
    const response = resultSchema.parse({
      classroomId: classroom.id,
      deletedAt: context.now.toISOString(),
    });
    await transaction.actionAudit.create({
      data: {
        actorId: context.actorId,
        source: context.source,
        actionName: commandName,
        targetType: "Classroom",
        targetId: classroom.id,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        outcome: "SUCCEEDED",
        resultResourceId: classroom.id,
        traceId: context.traceId,
      },
    });
    await transaction.idempotencyRecord.create({
      data: {
        actorId: context.actorId,
        commandName,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        response,
        resourceType: "Classroom",
        resourceId: classroom.id,
      },
    });
    return response;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 10_000,
  });
}

/**
 * Deletes only a classroom with no membership interval and no release. Any
 * classroom that has entered teaching history remains permanently readable.
 */
export async function deleteEmptyClassroom(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: DeleteClassroomInput,
): Promise<DeleteClassroomResult> {
  const input = inputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    source: context.source,
    classroomId: input.classroomId,
  });
  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try {
      return await runTransaction(database, context, input, requestHash);
    } catch (error) {
      const retryable = isRetryableSerializationError(error);
      if (retryable && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      if (error instanceof DeleteClassroomError) throw error;
      if (error instanceof SchoolMemberAuthorizationError) {
        throw new DeleteClassroomError(error.code);
      }
      if (retryable) throw new DeleteClassroomError("CONCURRENT_WRITE");
      throw error;
    }
  }
  throw new DeleteClassroomError("CONCURRENT_WRITE");
}
