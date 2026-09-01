import "server-only";

import { createHash, randomUUID } from "node:crypto";
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

export const classroomNameSchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(1).max(120));

const inputSchema = z
  .object({
    name: classroomNameSchema,
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const resultSchema = z
  .object({
    classroomId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    schoolId: z.uuid(),
  })
  .strict();

export type CreateClassroomInput = z.input<typeof inputSchema>;
export type CreateClassroomResult = z.infer<typeof resultSchema>;

export class CreateClassroomError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "ACCOUNT_DISABLED"
      | "SCHOOL_DISABLED"
      | "DUPLICATE_NAME"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "CreateClassroomError";
  }
}

const commandName = "create_classroom";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Classroom creation input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof inputSchema>,
  requestHash: string,
  error: CreateClassroomError,
): Promise<void> {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        source: context.source,
        actionName: commandName,
        // The classroom does not exist yet, so the failure is recorded against
        // the actor whose request was denied or conflicted.
        targetType: "AppUser",
        targetId: context.actorId,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        outcome:
          error.code === "FORBIDDEN" ||
          error.code === "ACCOUNT_DISABLED" ||
          error.code === "SCHOOL_DISABLED"
            ? "DENIED"
            : "CONFLICTED",
        errorCode: error.code,
        traceId: context.traceId,
      },
    });
  } catch {
    console.error("Failed to record classroom-creation failure audit", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof inputSchema>,
  requestHash: string,
): Promise<CreateClassroomResult> {
  return database.$transaction(
    async (transaction) => {
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
          throw new CreateClassroomError("IDEMPOTENCY_MISMATCH");
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
        throw new CreateClassroomError("FORBIDDEN");
      }

      const duplicate = await transaction.classroom.findFirst({
        where: { managerId: context.actorId, name: input.name },
        select: { id: true },
      });
      if (duplicate) throw new CreateClassroomError("DUPLICATE_NAME");

      const classroom = await transaction.classroom.create({
        data: {
          id: randomUUID(),
          name: input.name,
          managerId: context.actorId,
          schoolId: actor.schoolId,
          createdAt: context.now,
          updatedAt: context.now,
        },
        select: { id: true, name: true, schoolId: true, version: true },
      });
      const response = resultSchema.parse({
        classroomId: classroom.id,
        name: classroom.name,
        schoolId: classroom.schoolId,
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
          afterVersion: classroom.version,
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
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}

/**
 * A teacher creates a classroom in their own school and manages it. Cross-school
 * classrooms are rejected by the database constraints from D-059; this command
 * never touches accounts or memberships.
 */
export async function createClassroom(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: CreateClassroomInput,
): Promise<CreateClassroomResult> {
  const input = inputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({ source: context.source, name: input.name });
  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try {
      return await runTransaction(database, context, input, requestHash);
    } catch (error) {
      const retryable = isRetryableSerializationError(error);
      if (retryable && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      const domainError =
        error instanceof CreateClassroomError
          ? error
          : error instanceof SchoolMemberAuthorizationError
            ? new CreateClassroomError(error.code)
            : retryable
              ? new CreateClassroomError("CONCURRENT_WRITE")
              : null;
      if (domainError) {
        await recordFailureAudit(database, context, input, requestHash, domainError);
        throw domainError;
      }
      throw error;
    }
  }
  throw new CreateClassroomError("CONCURRENT_WRITE");
}
