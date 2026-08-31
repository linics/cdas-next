import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  classroomMembershipPayloadSchema,
  hashClassroomMembershipPayload,
} from "../../domain/classroom/classroom-membership-intent";
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

const commandInputSchema = z
  .object({
    actionIntentId: z.uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();
const commandResponseSchema = z
  .object({
    classroomId: z.uuid(),
    operation: z.enum(["ADD", "END"]),
    classroomVersion: z.int().positive(),
    changedMembershipIds: z.array(z.uuid()).min(1).max(50),
    changedStudentIds: z.array(z.uuid()).min(1).max(50),
    changedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ApplyClassroomMembershipChangeInput = z.input<
  typeof commandInputSchema
>;
export type ApplyClassroomMembershipChangeResult = z.infer<
  typeof commandResponseSchema
>;

export class ApplyClassroomMembershipChangeError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "ACTION_NOT_CONFIRMED"
      | "ACTION_EXPIRED"
      | "INTENT_TAMPERED"
      | "CLASSROOM_CHANGED"
      | "ROSTER_CHANGED"
      | "MEMBERSHIP_CHANGED"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "ApplyClassroomMembershipChangeError";
  }
}

const commandName = "apply_classroom_membership_change";

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Membership command input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof commandInputSchema>,
  requestHash: string,
  error: ApplyClassroomMembershipChangeError,
) {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        actionIntentId:
          error.code === "NOT_FOUND" ? undefined : input.actionIntentId,
        source: context.source,
        actionName: commandName,
        targetType: "ActionIntent",
        targetId: input.actionIntentId,
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
    console.error("Failed to record membership-change failure audit", {
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
): Promise<ApplyClassroomMembershipChangeResult> {
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
          throw new ApplyClassroomMembershipChangeError(
            "IDEMPOTENCY_MISMATCH",
          );
        }
        return commandResponseSchema.parse(existing.response);
      }

      const [actor, intent] = await Promise.all([
        transaction.appUser.findUnique({
          where: { id: context.actorId },
          select: {
            role: true,
            accountStatus: true,
            schoolId: true,
            school: { select: { status: true } },
          },
        }),
        transaction.actionIntent.findUnique({
          where: { id: input.actionIntentId },
        }),
      ]);
      if (!actor || !intent) {
        throw new ApplyClassroomMembershipChangeError("NOT_FOUND");
      }
      try {
        assertActiveBusinessActor(actor);
      } catch {
        throw new ApplyClassroomMembershipChangeError("NOT_FOUND");
      }
      if (actor.role !== "TEACHER") {
        throw new ApplyClassroomMembershipChangeError("FORBIDDEN");
      }
      if (
        intent.actorId !== context.actorId ||
        intent.decidedById !== context.actorId
      ) {
        throw new ApplyClassroomMembershipChangeError("FORBIDDEN");
      }
      if (intent.status !== "CONFIRMED") {
        throw new ApplyClassroomMembershipChangeError(
          "ACTION_NOT_CONFIRMED",
        );
      }
      if (intent.expiresAt <= context.now) {
        throw new ApplyClassroomMembershipChangeError("ACTION_EXPIRED");
      }

      let payload: z.infer<typeof classroomMembershipPayloadSchema>;
      try {
        payload = classroomMembershipPayloadSchema.parse(intent.payload);
      } catch {
        throw new ApplyClassroomMembershipChangeError("INTENT_TAMPERED");
      }
      if (
        intent.agentRunId !== null ||
        intent.actionName !== commandName ||
        intent.targetType !== "Classroom" ||
        intent.targetId !== payload.classroomId ||
        intent.expectedVersion !== payload.expectedClassroomVersion ||
        hashClassroomMembershipPayload(payload) !== intent.payloadHash
      ) {
        throw new ApplyClassroomMembershipChangeError("INTENT_TAMPERED");
      }

      const classroom = await transaction.classroom.findUnique({
        where: { id: payload.classroomId },
        select: {
          id: true,
          name: true,
          managerId: true,
          version: true,
          schoolId: true,
        },
      });
      if (
        !classroom ||
        classroom.managerId !== context.actorId ||
        classroom.schoolId !== actor.schoolId
      ) {
        throw new ApplyClassroomMembershipChangeError("NOT_FOUND");
      }
      if (
        classroom.version !== payload.expectedClassroomVersion ||
        classroom.name !== payload.classroomName
      ) {
        throw new ApplyClassroomMembershipChangeError("CLASSROOM_CHANGED");
      }

      const changedMembershipIds: string[] = [];
      const changedStudentIds: string[] = [];
      if (payload.operation === "ADD") {
        const students = await transaction.appUser.findMany({
          where: {
            id: { in: payload.students.map((student) => student.studentId) },
            accountStatus: "ACTIVE",
            schoolId: classroom.schoolId,
          },
          select: { id: true, role: true, displayName: true, rosterKey: true },
        });
        const currentById = new Map(students.map((student) => [student.id, student]));
        if (
          students.length !== payload.students.length ||
          payload.students.some((snapshot) => {
            const student = currentById.get(snapshot.studentId);
            return (
              !student ||
              student.role !== "STUDENT" ||
              student.displayName !== snapshot.displayName ||
              student.rosterKey !== snapshot.rosterKey
            );
          })
        ) {
          throw new ApplyClassroomMembershipChangeError("ROSTER_CHANGED");
        }
        const conflicts = await transaction.classroomMembership.count({
          where: {
            classroomId: classroom.id,
            studentId: { in: payload.students.map((student) => student.studentId) },
            OR: [{ endedAt: null }, { endedAt: { gt: context.now } }],
          },
        });
        if (conflicts > 0) {
          throw new ApplyClassroomMembershipChangeError("MEMBERSHIP_CHANGED");
        }
        for (const student of payload.students) {
          const membershipId = randomUUID();
          await transaction.classroomMembership.create({
            data: {
              id: membershipId,
              classroomId: classroom.id,
              studentId: student.studentId,
              joinedAt: context.now,
            },
          });
          changedMembershipIds.push(membershipId);
          changedStudentIds.push(student.studentId);
        }
      } else {
        const membership = await transaction.classroomMembership.findUnique({
          where: { id: payload.membershipId },
          select: {
            id: true,
            classroomId: true,
            studentId: true,
            joinedAt: true,
            endedAt: true,
            student: { select: { role: true, displayName: true } },
          },
        });
        if (
          !membership ||
          membership.classroomId !== classroom.id ||
          membership.studentId !== payload.student.studentId ||
          membership.student.role !== "STUDENT" ||
          membership.student.displayName !== payload.student.displayName ||
          membership.joinedAt > context.now ||
          membership.endedAt !== null
        ) {
          throw new ApplyClassroomMembershipChangeError("MEMBERSHIP_CHANGED");
        }
        const ended = await transaction.classroomMembership.updateMany({
          where: {
            id: membership.id,
            classroomId: classroom.id,
            studentId: membership.studentId,
            endedAt: null,
            joinedAt: { lte: context.now },
          },
          data: { endedAt: context.now },
        });
        if (ended.count !== 1) {
          throw new ApplyClassroomMembershipChangeError("MEMBERSHIP_CHANGED");
        }
        changedMembershipIds.push(membership.id);
        changedStudentIds.push(membership.studentId);
      }

      const [consumedIntent, advancedClassroom] = await Promise.all([
        transaction.actionIntent.updateMany({
          where: {
            id: intent.id,
            actorId: context.actorId,
            decidedById: context.actorId,
            agentRunId: null,
            status: "CONFIRMED",
            payloadHash: intent.payloadHash,
            expiresAt: { gt: context.now },
          },
          data: { status: "EXECUTED", executedAt: context.now },
        }),
        transaction.classroom.updateMany({
          where: {
            id: classroom.id,
            managerId: context.actorId,
            version: payload.expectedClassroomVersion,
          },
          data: { version: { increment: 1 }, updatedAt: context.now },
        }),
      ]);
      if (consumedIntent.count !== 1 || advancedClassroom.count !== 1) {
        throw new ApplyClassroomMembershipChangeError("CONCURRENT_WRITE");
      }

      const response = commandResponseSchema.parse({
        classroomId: classroom.id,
        operation: payload.operation,
        classroomVersion: classroom.version + 1,
        changedMembershipIds,
        changedStudentIds,
        changedAt: context.now.toISOString(),
      });
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
          afterVersion: classroom.version + 1,
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

export async function applyClassroomMembershipChange(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: ApplyClassroomMembershipChangeInput,
): Promise<ApplyClassroomMembershipChangeResult> {
  const input = commandInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    source: context.source,
    actionIntentId: input.actionIntentId,
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
        error instanceof ApplyClassroomMembershipChangeError
          ? error
          : retryable
            ? new ApplyClassroomMembershipChangeError("CONCURRENT_WRITE")
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
  throw new ApplyClassroomMembershipChangeError("CONCURRENT_WRITE");
}
