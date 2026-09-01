import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client";
import {
  pendingTeacherAuthSubject,
  schoolNameSchema,
  staffNoSchema,
  teacherIdentifier,
} from "../../domain/school/identity";
import { requireActivePlatformAdmin } from "../school/admin-authorization";
import { hashPassword } from "../auth/local-auth";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const teacherIdSchema = z.uuid();
const schoolIdSchema = z.uuid();

const registerSchoolTeacherInputSchema = z
  .object({
    schoolId: schoolIdSchema,
    displayName: schoolNameSchema,
    staffNo: staffNoSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const setTeacherAccountStatusInputSchema = z
  .object({
    teacherId: teacherIdSchema,
    accountStatus: z.enum(["ACTIVE", "DISABLED"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const registerTeacherReplaySchema = z
  .object({
    teacherId: teacherIdSchema,
    provisioningId: z.uuid(),
  })
  .strict();
const teacherStatusReplaySchema = z
  .object({
    teacherId: teacherIdSchema,
    accountStatus: z.enum(["ACTIVE", "DISABLED"]),
  })
  .strict();

export const registerSchoolTeacherResultSchema = z
  .object({
    teacherId: teacherIdSchema,
    provisioningId: z.uuid(),
    status: z.enum(["CREATED", "EXISTING"]),
  })
  .strict();
export const setTeacherAccountStatusResultSchema = teacherStatusReplaySchema;
const issueTeacherPasswordInputSchema = z.object({ teacherId: teacherIdSchema, idempotencyKey: idempotencyKeySchema }).strict();
export const issueTeacherPasswordResultSchema = z.object({ teacherId: teacherIdSchema, oneTimePassword: z.string().min(20) }).strict();
export type IssueTeacherPasswordInput = z.input<typeof issueTeacherPasswordInputSchema>;
export type IssueTeacherPasswordResult = z.infer<typeof issueTeacherPasswordResultSchema>;

export type RegisterSchoolTeacherInput = z.input<
  typeof registerSchoolTeacherInputSchema
>;
export type RegisterSchoolTeacherResult = z.infer<
  typeof registerSchoolTeacherResultSchema
>;
export type SetTeacherAccountStatusInput = z.input<
  typeof setTeacherAccountStatusInputSchema
>;
export type SetTeacherAccountStatusResult = z.infer<
  typeof setTeacherAccountStatusResultSchema
>;

export class TeacherAdminCommandError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "STAFF_NO_CONFLICT"
      | "SCHOOL_DISABLED"
      | "IDEMPOTENCY_MISMATCH"
      | "PASSWORD_ALREADY_ISSUED"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "TeacherAdminCommandError";
  }
}

function issueOneTimePassword(): string {
  return `Cdas-${randomBytes(18).toString("base64url")}9a`;
}

export async function issueTeacherOneTimePassword(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: IssueTeacherPasswordInput,
): Promise<IssueTeacherPasswordResult> {
  const input = issueTeacherPasswordInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const oneTimePassword = issueOneTimePassword();
  const passwordHash = await hashPassword(oneTimePassword);
  const requestHash = hashSafeRequest({ action: "issue_teacher_password", teacherId: input.teacherId });
  const result = await database.$transaction(async (transaction) => {
    await requireActivePlatformAdmin(transaction, context.actorId).catch(() => { throw new TeacherAdminCommandError("FORBIDDEN"); });
    const teacher = await transaction.appUser.findUnique({ where: { id: input.teacherId }, select: { id: true, role: true, authSubject: true, staffNo: true, school: { select: { code: true } } } });
    if (!teacher || teacher.role !== "TEACHER") throw new TeacherAdminCommandError("NOT_FOUND");
    if (!teacher.school?.code || !teacher.staffNo) {
      throw new TeacherAdminCommandError("NOT_FOUND");
    }
    if (
      !teacher.authSubject.startsWith("pending:") &&
      teacher.authSubject !== `local:${teacher.id}`
    ) {
      throw new TeacherAdminCommandError("STAFF_NO_CONFLICT");
    }
    const existing = await transaction.idempotencyRecord.findUnique({
      where: {
        actorId_commandName_idempotencyKey: {
          actorId: context.actorId,
          commandName: "issue_teacher_password",
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new TeacherAdminCommandError("IDEMPOTENCY_MISMATCH");
      }
      throw new TeacherAdminCommandError("PASSWORD_ALREADY_ISSUED");
    }
    await transaction.localCredential.upsert({
      where: { userId: teacher.id },
      create: { userId: teacher.id, identifier: teacherIdentifier(teacher.school?.code ?? "", teacher.staffNo ?? ""), passwordHash, mustChangePassword: true },
      update: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: null },
    });
    if (teacher.authSubject.startsWith("pending:")) await transaction.appUser.update({ where: { id: teacher.id }, data: { authSubject: `local:${teacher.id}` } });
    await transaction.authSession.updateMany({ where: { userId: teacher.id, revokedAt: null }, data: { revokedAt: context.now } });
    await transaction.idempotencyRecord.create({
      data: {
        actorId: context.actorId,
        commandName: "issue_teacher_password",
        idempotencyKey: input.idempotencyKey,
        requestHash,
        response: { teacherId: teacher.id, issued: true },
        resourceType: "AppUser",
        resourceId: teacher.id,
      },
    });
    await transaction.actionAudit.create({
      data: {
        actorId: context.actorId,
        source: context.source,
        actionName: "issue_teacher_password",
        targetType: "AppUser",
        targetId: teacher.id,
        requestHash,
        idempotencyKey: input.idempotencyKey,
        outcome: "SUCCEEDED",
        resultResourceId: teacher.id,
        traceId: context.traceId,
      },
    });
    return { teacherId: teacher.id, oneTimePassword };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return issueTeacherPasswordResultSchema.parse(result);
}

function hashSafeRequest(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Teacher admin command cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

function requireMatchingRequest(
  existing: { requestHash: string },
  requestHash: string,
): void {
  if (existing.requestHash !== requestHash) {
    throw new TeacherAdminCommandError("IDEMPOTENCY_MISMATCH");
  }
}

export async function registerSchoolTeacher(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: RegisterSchoolTeacherInput,
): Promise<RegisterSchoolTeacherResult> {
  const input = registerSchoolTeacherInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashSafeRequest({
    action: "register_school_teacher",
    schoolId: input.schoolId,
    staffNo: input.staffNo,
    displayName: input.displayName,
  });

  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try {
      const result = await database.$transaction(async (transaction) => {
      try {
        await requireActivePlatformAdmin(transaction, context.actorId);
      } catch {
        throw new TeacherAdminCommandError("FORBIDDEN");
      }
      const existing = await transaction.idempotencyRecord.findUnique({
        where: {
          actorId_commandName_idempotencyKey: {
            actorId: context.actorId,
            commandName: "register_school_teacher",
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        requireMatchingRequest(existing, requestHash);
        return {
          ...registerTeacherReplaySchema.parse(existing.response),
          status: "EXISTING" as const,
        };
      }
      const school = await transaction.school.findUnique({
        where: { id: input.schoolId },
        select: { id: true, status: true },
      });
      if (!school) {
        throw new TeacherAdminCommandError("NOT_FOUND");
      }
      if (school.status !== "ACTIVE") {
        throw new TeacherAdminCommandError("SCHOOL_DISABLED");
      }
      const provisioningId = randomUUID();
      const teacherId = randomUUID();
      const teacher = await transaction.appUser.create({
        data: {
          id: teacherId,
          authSubject: pendingTeacherAuthSubject(provisioningId),
          role: "TEACHER",
          displayName: input.displayName,
          schoolId: school.id,
          staffNo: input.staffNo,
          accountStatus: "ACTIVE",
          legacyProfile: false,
        },
        select: { id: true },
      });
      const provisioning = await transaction.teacherProvisioning.create({
        data: {
          id: provisioningId,
          schoolId: school.id,
          staffNo: input.staffNo,
          displayName: input.displayName,
          appUserId: teacher.id,
          status: "PENDING",
        },
        select: { id: true },
      });
      const replay = {
        teacherId: teacher.id,
        provisioningId: provisioning.id,
      };
      await Promise.all([
        transaction.idempotencyRecord.create({
          data: {
            actorId: context.actorId,
            commandName: "register_school_teacher",
            idempotencyKey: input.idempotencyKey,
            requestHash,
            response: replay,
            resourceType: "AppUser",
            resourceId: teacher.id,
          },
        }),
        transaction.actionAudit.create({
          data: {
            actorId: context.actorId,
            source: context.source,
            actionName: "register_school_teacher",
            targetType: "AppUser",
            targetId: teacher.id,
            requestHash,
            idempotencyKey: input.idempotencyKey,
            outcome: "SUCCEEDED",
            resultResourceId: teacher.id,
            traceId: context.traceId,
          },
        }),
      ]);
      return { ...replay, status: "CREATED" as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return registerSchoolTeacherResultSchema.parse(result);
    } catch (error) {
      if (
        isRetryableSerializationError(error) &&
        attempt < serializableRetryAttempts
      ) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await database.idempotencyRecord.findUnique({
          where: {
            actorId_commandName_idempotencyKey: {
              actorId: context.actorId,
              commandName: "register_school_teacher",
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing) {
          requireMatchingRequest(existing, requestHash);
          return registerSchoolTeacherResultSchema.parse({
            ...registerTeacherReplaySchema.parse(existing.response),
            status: "EXISTING",
          });
        }
        throw new TeacherAdminCommandError("STAFF_NO_CONFLICT");
      }
      if (isRetryableSerializationError(error)) {
        throw new TeacherAdminCommandError("CONCURRENT_WRITE");
      }
      throw error;
    }
  }
  throw new TeacherAdminCommandError("CONCURRENT_WRITE");
}

export async function setTeacherAccountStatus(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SetTeacherAccountStatusInput,
): Promise<SetTeacherAccountStatusResult> {
  const input = setTeacherAccountStatusInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashSafeRequest({
    action: "set_teacher_account_status",
    teacherId: input.teacherId,
    accountStatus: input.accountStatus,
  });
  const result = await database.$transaction(async (transaction) => {
    try {
      await requireActivePlatformAdmin(transaction, context.actorId);
    } catch {
      throw new TeacherAdminCommandError("FORBIDDEN");
    }
    const existing = await transaction.idempotencyRecord.findUnique({
      where: {
        actorId_commandName_idempotencyKey: {
          actorId: context.actorId,
          commandName: "set_teacher_account_status",
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      requireMatchingRequest(existing, requestHash);
      return teacherStatusReplaySchema.parse(existing.response);
    }
    const teacher = await transaction.appUser.findUnique({
      where: { id: input.teacherId },
      select: { id: true, role: true, accountStatus: true },
    });
    if (!teacher || teacher.role !== "TEACHER") {
      throw new TeacherAdminCommandError("NOT_FOUND");
    }
    const updated =
      teacher.accountStatus === input.accountStatus
        ? teacher
        : await transaction.appUser.update({
            where: { id: teacher.id },
            data: { accountStatus: input.accountStatus },
            select: { id: true, accountStatus: true },
          });
    const replay = {
      teacherId: updated.id,
      accountStatus: updated.accountStatus,
    };
    await Promise.all([
      transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName: "set_teacher_account_status",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          response: replay,
          resourceType: "AppUser",
          resourceId: updated.id,
        },
      }),
      transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: "set_teacher_account_status",
          targetType: "AppUser",
          targetId: updated.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          resultResourceId: updated.id,
          traceId: context.traceId,
        },
      }),
    ]);
    return replay;
  });
  return setTeacherAccountStatusResultSchema.parse(result);
}
