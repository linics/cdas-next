import "server-only";

import { createHash, randomInt } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { hashPassword } from "../auth/local-auth";
import { passwordSchema } from "../auth/password-policy";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";
import { isActiveSchoolMember } from "../school/teacher-authorization";

const inputSchema = z
  .object({
    classroomId: z.uuid(),
    studentId: z.uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

export type ResetStudentPasswordInput = z.input<typeof inputSchema>;

export class ResetStudentPasswordError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "ACCOUNT_DISABLED"
      | "NO_LOCAL_CREDENTIAL"
      | "IDEMPOTENCY_MISMATCH"
      | "PASSWORD_ALREADY_ISSUED"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "ResetStudentPasswordError";
  }
}

const commandName = "reset_student_password";
// No 0/O, 1/I/L: the password is read aloud or copied by hand.
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const letters = "ABCDEFGHJKMNPQRSTUVWXYZ";
const digits = "23456789";

function pick(characters: string): string {
  return characters[randomInt(characters.length)]!;
}

/**
 * Random, readable and never derivable from the student number (D-073).
 * One letter and one digit are guaranteed so the result meets the policy.
 */
export function issueStudentTemporaryPassword(): string {
  const characters = [
    pick(letters),
    pick(digits),
    ...Array.from({ length: 10 }, () => pick(alphabet)),
  ];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [characters[index], characters[swap]] = [characters[swap]!, characters[index]!];
  }
  const password = [0, 4, 8]
    .map((start) => characters.slice(start, start + 4).join(""))
    .join("-");
  return passwordSchema.parse(password);
}

function requestHashFor(input: z.infer<typeof inputSchema>): string {
  const canonical = canonicalize({
    action: commandName,
    classroomId: input.classroomId,
    studentId: input.studentId,
  });
  if (canonical === undefined) throw new TypeError("Reset request cannot be canonicalized");
  return createHash("sha256").update(canonical).digest("hex");
}

async function recordFailure(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof inputSchema>,
  requestHash: string,
  error: ResetStudentPasswordError,
) {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        source: context.source,
        actionName: commandName,
        targetType: "AppUser",
        targetId: input.studentId,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        outcome:
          error.code === "NOT_FOUND" || error.code === "FORBIDDEN"
            ? "DENIED"
            : "CONFLICTED",
        errorCode: error.code,
        traceId: context.traceId,
      },
    });
  } catch {
    console.error("Failed to record student password reset failure", {
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

/**
 * A class manager issues a new temporary password to a current member of that
 * class (D-073). The student's sessions end, the next sign-in must change the
 * password, lockout clears. The plaintext is returned once and stored nowhere:
 * not in the audit, the idempotency record or logs. A replay of the same key
 * never issues or returns a password again.
 */
export async function resetStudentPassword(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: ResetStudentPasswordInput,
): Promise<{ studentId: string; temporaryPassword: string }> {
  const input = inputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = requestHashFor(input);
  // Hashing is slow on purpose; keep it outside the transaction.
  const temporaryPassword = issueStudentTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    await database.$transaction(
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
          throw new ResetStudentPasswordError(
            existing.requestHash === requestHash
              ? "PASSWORD_ALREADY_ISSUED"
              : "IDEMPOTENCY_MISMATCH",
          );
        }

        if (!(await isActiveSchoolMember(transaction, context.actorId))) {
          throw new ResetStudentPasswordError("NOT_FOUND");
        }
        const [actor, classroom] = await Promise.all([
          transaction.appUser.findUnique({
            where: { id: context.actorId },
            select: { role: true, schoolId: true },
          }),
          transaction.classroom.findUnique({
            where: { id: input.classroomId },
            select: {
              managerId: true,
              schoolId: true,
              memberships: {
                where: {
                  studentId: input.studentId,
                  joinedAt: { lte: context.now },
                  OR: [{ endedAt: null }, { endedAt: { gt: context.now } }],
                },
                select: { id: true },
              },
            },
          }),
        ]);
        if (!actor || actor.role !== "TEACHER") {
          throw new ResetStudentPasswordError("FORBIDDEN");
        }
        if (
          !classroom ||
          classroom.managerId !== context.actorId ||
          classroom.schoolId !== actor.schoolId ||
          classroom.memberships.length === 0
        ) {
          throw new ResetStudentPasswordError("NOT_FOUND");
        }

        const student = await transaction.appUser.findUnique({
          where: { id: input.studentId },
          select: {
            role: true,
            schoolId: true,
            accountStatus: true,
            school: { select: { status: true } },
            localCredential: { select: { id: true } },
          },
        });
        if (
          !student ||
          student.role !== "STUDENT" ||
          student.schoolId !== actor.schoolId
        ) {
          throw new ResetStudentPasswordError("NOT_FOUND");
        }
        // Enabling an account is its own admin action; a reset never revives one.
        if (student.accountStatus !== "ACTIVE" || student.school?.status !== "ACTIVE") {
          throw new ResetStudentPasswordError("ACCOUNT_DISABLED");
        }
        if (!student.localCredential) {
          throw new ResetStudentPasswordError("NO_LOCAL_CREDENTIAL");
        }

        await transaction.localCredential.update({
          where: { userId: input.studentId },
          data: {
            passwordHash,
            mustChangePassword: true,
            failedLoginCount: 0,
            lockedUntil: null,
            passwordChangedAt: null,
          },
        });
        await transaction.authSession.updateMany({
          where: { userId: input.studentId, revokedAt: null },
          data: { revokedAt: context.now },
        });
        await transaction.idempotencyRecord.create({
          data: {
            actorId: context.actorId,
            commandName,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            response: { studentId: input.studentId, issued: true },
            resourceType: "AppUser",
            resourceId: input.studentId,
          },
        });
        await transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            source: context.source,
            actionName: commandName,
            targetType: "AppUser",
            targetId: input.studentId,
            requestHash,
            idempotencyKey: input.idempotencyKey,
            outcome: "SUCCEEDED",
            resultResourceId: input.studentId,
            traceId: context.traceId,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  } catch (error) {
    const domainError =
      error instanceof ResetStudentPasswordError
        ? error
        : error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code?: unknown }).code === "P2034"
          ? new ResetStudentPasswordError("CONCURRENT_WRITE")
          : null;
    if (domainError) {
      if (domainError.code !== "PASSWORD_ALREADY_ISSUED") {
        await recordFailure(database, context, input, requestHash, domainError);
      }
      throw domainError;
    }
    throw error;
  }

  return { studentId: input.studentId, temporaryPassword };
}
