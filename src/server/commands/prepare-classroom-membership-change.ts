import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  type ClassroomMembershipPayload,
  hashClassroomMembershipPayload,
} from "../../domain/classroom/classroom-membership-intent";
import { rosterKeySchema } from "../../domain/classroom/roster-key";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";
import { assertActiveBusinessActor } from "../school/teacher-authorization";

const baseInput = z.object({
  classroomId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
});
const commandInputSchema = z.discriminatedUnion("operation", [
  baseInput
    .extend({
      operation: z.literal("ADD"),
      rosterKeys: z.array(rosterKeySchema).min(1).max(50),
    })
    .strict(),
  baseInput
    .extend({
      operation: z.literal("END"),
      membershipId: z.uuid(),
    })
    .strict(),
]);

const studentSchema = z
  .object({ studentId: z.uuid(), displayName: z.string().trim().min(1) })
  .strict();
const commandResponseSchema = z.discriminatedUnion("operation", [
  z
    .object({
      actionIntentId: z.uuid(),
      operation: z.literal("ADD"),
      classroomId: z.uuid(),
      classroomName: z.string().trim().min(1),
      expectedClassroomVersion: z.int().positive(),
      students: z.array(studentSchema).min(1).max(50),
      payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      actionIntentId: z.uuid(),
      operation: z.literal("END"),
      classroomId: z.uuid(),
      classroomName: z.string().trim().min(1),
      expectedClassroomVersion: z.int().positive(),
      membershipId: z.uuid(),
      student: studentSchema,
      payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
]);

export type PrepareClassroomMembershipChangeInput = z.input<
  typeof commandInputSchema
>;
export type PrepareClassroomMembershipChangeResult = z.infer<
  typeof commandResponseSchema
>;

export class PrepareClassroomMembershipChangeError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "ROSTER_NOT_FOUND"
      | "MEMBERSHIP_NOT_CURRENT"
      | "INTERVAL_CONFLICT"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "PrepareClassroomMembershipChangeError";
  }
}

const commandName = "prepare_classroom_membership_change";
const actionName = "apply_classroom_membership_change";
const intentLifetimeMilliseconds = 10 * 60 * 1_000;

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Membership preparation input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

function normalizeInput(
  input: z.infer<typeof commandInputSchema>,
): z.infer<typeof commandInputSchema> {
  return input.operation === "ADD"
    ? { ...input, rosterKeys: [...new Set(input.rosterKeys)].sort() }
    : input;
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: PrepareClassroomMembershipChangeError,
) {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        source: context.source,
        actionName: commandName,
        targetType: "Classroom",
        targetId: input.classroomId,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        outcome:
          error.code === "FORBIDDEN" || error.code === "NOT_FOUND"
            ? "DENIED"
            : "CONFLICTED",
        errorCode: error.code,
        traceId: context.traceId,
      },
    });
  } catch {
    console.error("Failed to record membership-preparation failure audit", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function runTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
): Promise<PrepareClassroomMembershipChangeResult> {
  return database.$transaction(
    async (transaction) => {
      const existing = await transaction.idempotencyRecord.findUnique({
        where: {
          actorId_commandName_idempotencyKey: {
            actorId: context.actorId,
            commandName,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new PrepareClassroomMembershipChangeError(
            "IDEMPOTENCY_MISMATCH",
          );
        }
        return commandResponseSchema.parse(existing.response);
      }

      const [actor, classroom] = await Promise.all([
        transaction.appUser.findUnique({
          where: { id: context.actorId },
          select: {
            role: true,
            accountStatus: true,
            schoolId: true,
            school: { select: { status: true } },
          },
        }),
        transaction.classroom.findUnique({
          where: { id: input.classroomId },
          select: {
            id: true,
            name: true,
            managerId: true,
            version: true,
            schoolId: true,
          },
        }),
      ]);
      if (!actor) throw new PrepareClassroomMembershipChangeError("NOT_FOUND");
      try {
        assertActiveBusinessActor(actor);
      } catch {
        throw new PrepareClassroomMembershipChangeError("NOT_FOUND");
      }
      if (actor.role !== "TEACHER") {
        throw new PrepareClassroomMembershipChangeError("FORBIDDEN");
      }
      if (
        !classroom ||
        classroom.managerId !== context.actorId ||
        classroom.schoolId !== actor.schoolId
      ) {
        throw new PrepareClassroomMembershipChangeError("NOT_FOUND");
      }

      let payload: ClassroomMembershipPayload;
      if (input.operation === "ADD") {
        const students = await transaction.appUser.findMany({
          where: {
            role: "STUDENT",
            accountStatus: "ACTIVE",
            schoolId: classroom.schoolId,
            rosterKey: { in: input.rosterKeys },
          },
          orderBy: { rosterKey: "asc" },
          select: { id: true, displayName: true, rosterKey: true },
        });
        if (
          students.length !== input.rosterKeys.length ||
          students.some((student) => !student.rosterKey)
        ) {
          throw new PrepareClassroomMembershipChangeError("ROSTER_NOT_FOUND");
        }
        const conflicts = await transaction.classroomMembership.count({
          where: {
            classroomId: classroom.id,
            studentId: { in: students.map((student) => student.id) },
            OR: [{ endedAt: null }, { endedAt: { gt: context.now } }],
          },
        });
        if (conflicts > 0) {
          throw new PrepareClassroomMembershipChangeError("INTERVAL_CONFLICT");
        }
        payload = {
          schemaVersion: 1,
          operation: "ADD",
          classroomId: classroom.id,
          classroomName: classroom.name,
          expectedClassroomVersion: classroom.version,
          students: students.map((student) => ({
            studentId: student.id,
            displayName: student.displayName,
            rosterKey: student.rosterKey!,
          })),
        };
      } else {
        const membership = await transaction.classroomMembership.findUnique({
          where: { id: input.membershipId },
          select: {
            id: true,
            classroomId: true,
            joinedAt: true,
            endedAt: true,
            student: {
              select: { id: true, role: true, displayName: true },
            },
          },
        });
        if (!membership || membership.classroomId !== classroom.id) {
          throw new PrepareClassroomMembershipChangeError("NOT_FOUND");
        }
        if (
          membership.student.role !== "STUDENT" ||
          membership.joinedAt > context.now ||
          membership.endedAt !== null
        ) {
          throw new PrepareClassroomMembershipChangeError(
            "MEMBERSHIP_NOT_CURRENT",
          );
        }
        payload = {
          schemaVersion: 1,
          operation: "END",
          classroomId: classroom.id,
          classroomName: classroom.name,
          expectedClassroomVersion: classroom.version,
          membershipId: membership.id,
          student: {
            studentId: membership.student.id,
            displayName: membership.student.displayName,
          },
        };
      }

      const payloadHash = hashClassroomMembershipPayload(payload);
      const expiresAt = new Date(
        context.now.getTime() + intentLifetimeMilliseconds,
      );
      const intent = await transaction.actionIntent.create({
        data: {
          actorId: context.actorId,
          actionName,
          payload,
          payloadHash,
          targetType: "Classroom",
          targetId: classroom.id,
          expectedVersion: classroom.version,
          expiresAt,
          createdAt: context.now,
        },
        select: { id: true },
      });
      const response =
        payload.operation === "ADD"
          ? {
              actionIntentId: intent.id,
              operation: "ADD" as const,
              classroomId: classroom.id,
              classroomName: classroom.name,
              expectedClassroomVersion: classroom.version,
              students: payload.students.map((student) => ({
                studentId: student.studentId,
                displayName: student.displayName,
              })),
              payloadHash,
              expiresAt: expiresAt.toISOString(),
            }
          : {
              actionIntentId: intent.id,
              operation: "END" as const,
              classroomId: classroom.id,
              classroomName: classroom.name,
              expectedClassroomVersion: classroom.version,
              membershipId: payload.membershipId,
              student: payload.student,
              payloadHash,
              expiresAt: expiresAt.toISOString(),
            };
      const parsedResponse = commandResponseSchema.parse(response);

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          actionIntentId: intent.id,
          source: context.source,
          actionName: commandName,
          targetType: "Classroom",
          targetId: classroom.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: classroom.version,
          afterVersion: classroom.version,
          resultResourceId: intent.id,
          traceId: context.traceId,
        },
      });
      await transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          response: parsedResponse,
          resourceType: "ActionIntent",
          resourceId: intent.id,
        },
      });
      return parsedResponse;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}

export async function prepareClassroomMembershipChange(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: PrepareClassroomMembershipChangeInput,
): Promise<PrepareClassroomMembershipChangeResult> {
  const input = normalizeInput(commandInputSchema.parse(rawInput));
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    source: context.source,
    operation: input.operation,
    classroomId: input.classroomId,
    ...(input.operation === "ADD"
      ? { rosterKeys: input.rosterKeys }
      : { membershipId: input.membershipId }),
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
      const domainError =
        error instanceof PrepareClassroomMembershipChangeError
          ? error
          : retryable
            ? new PrepareClassroomMembershipChangeError("CONCURRENT_WRITE")
            : null;
      if (domainError) {
        await recordFailureAudit(
          database,
          context,
          input,
          requestHash,
          domainError,
        );
        throw domainError;
      }
      throw error;
    }
  }
  throw new PrepareClassroomMembershipChangeError("CONCURRENT_WRITE");
}
