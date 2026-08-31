import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  databaseUuidSchema,
  generateSchoolCode,
  generateTeacherInvite,
  hashTeacherInvite,
} from "../../domain/school/identity";
import { requireActivePlatformAdmin } from "../school/admin-authorization";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const schoolNameSchema = z.string().trim().min(1).max(120);
const schoolIdSchema = databaseUuidSchema;

const createSchoolInputSchema = z
  .object({ name: schoolNameSchema, idempotencyKey: idempotencyKeySchema })
  .strict();
const setSchoolStatusInputSchema = z
  .object({
    schoolId: schoolIdSchema,
    status: z.enum(["ACTIVE", "DISABLED"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const updateSchoolNameInputSchema = z
  .object({
    schoolId: schoolIdSchema,
    name: schoolNameSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const resetSchoolTeacherInviteInputSchema = z
  .object({ schoolId: schoolIdSchema, idempotencyKey: idempotencyKeySchema })
  .strict();

const createSchoolReplaySchema = z
  .object({ schoolId: schoolIdSchema, schoolCode: z.string().trim().min(1) })
  .strict();
const schoolStatusReplaySchema = z
  .object({ schoolId: schoolIdSchema, status: z.enum(["ACTIVE", "DISABLED"]) })
  .strict();
const schoolNameReplaySchema = z
  .object({ schoolId: schoolIdSchema, name: schoolNameSchema })
  .strict();
const schoolInviteReplaySchema = z
  .object({ schoolId: schoolIdSchema, schoolCode: z.string().trim().min(1) })
  .strict();

export const createSchoolResultSchema = z
  .object({
    schoolId: schoolIdSchema,
    schoolCode: z.string().trim().min(1),
    status: z.enum(["CREATED", "EXISTING"]),
    teacherInviteCode: z.string().min(1).nullable(),
  })
  .strict();
export const setSchoolStatusResultSchema = z
  .object({ schoolId: schoolIdSchema, status: z.enum(["ACTIVE", "DISABLED"]) })
  .strict();
export const updateSchoolNameResultSchema = z
  .object({ schoolId: schoolIdSchema, name: schoolNameSchema })
  .strict();
export const resetSchoolTeacherInviteResultSchema = z
  .object({
    schoolId: schoolIdSchema,
    schoolCode: z.string().trim().min(1),
    status: z.enum(["CREATED", "EXISTING"]),
    teacherInviteCode: z.string().min(1).nullable(),
  })
  .strict();

export type CreateSchoolInput = z.input<typeof createSchoolInputSchema>;
export type CreateSchoolResult = z.infer<typeof createSchoolResultSchema>;
export type SetSchoolStatusInput = z.input<typeof setSchoolStatusInputSchema>;
export type SetSchoolStatusResult = z.infer<typeof setSchoolStatusResultSchema>;
export type UpdateSchoolNameInput = z.input<typeof updateSchoolNameInputSchema>;
export type UpdateSchoolNameResult = z.infer<typeof updateSchoolNameResultSchema>;
export type ResetSchoolTeacherInviteInput = z.input<
  typeof resetSchoolTeacherInviteInputSchema
>;
export type ResetSchoolTeacherInviteResult = z.infer<
  typeof resetSchoolTeacherInviteResultSchema
>;

export type SchoolCommandRandomness = Readonly<{
  generateSchoolCode: () => string;
  generateTeacherInvite: () => string;
}>;

const defaultRandomness: SchoolCommandRandomness = {
  generateSchoolCode,
  generateTeacherInvite,
};

export class SchoolAdminCommandError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "SchoolAdminCommandError";
  }
}

function hashSafeRequest(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("School command cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

function requireMatchingRequest(
  existing: { requestHash: string },
  requestHash: string,
): void {
  if (existing.requestHash !== requestHash) {
    throw new SchoolAdminCommandError("IDEMPOTENCY_MISMATCH");
  }
}

async function findUnusedSchoolCode(
  transaction: Parameters<PrismaClient["$transaction"]>[0] extends (
    transaction: infer Transaction,
  ) => unknown
    ? Transaction
    : never,
  randomness: SchoolCommandRandomness,
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = randomness.generateSchoolCode();
    const existing = await transaction.school.findUnique({
      where: { code: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new SchoolAdminCommandError("CONCURRENT_WRITE");
}

export async function createSchool(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: CreateSchoolInput,
  randomness: SchoolCommandRandomness = defaultRandomness,
): Promise<CreateSchoolResult> {
  const input = createSchoolInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashSafeRequest({
    action: "create_school",
    name: input.name,
  });

  const result = await database.$transaction(async (transaction) => {
    const existingIdempotency = await transaction.idempotencyRecord.findUnique({
      where: {
        actorId_commandName_idempotencyKey: {
          actorId: context.actorId,
          commandName: "create_school",
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingIdempotency) {
      requireMatchingRequest(existingIdempotency, requestHash);
      const replay = createSchoolReplaySchema.parse(existingIdempotency.response);
      return {
        ...replay,
        status: "EXISTING" as const,
        teacherInviteCode: null,
      };
    }

    try {
      await requireActivePlatformAdmin(transaction, context.actorId);
    } catch {
      throw new SchoolAdminCommandError("FORBIDDEN");
    }

    const schoolCode = await findUnusedSchoolCode(transaction, randomness);
    const teacherInviteCode = randomness.generateTeacherInvite();
    const school = await transaction.school.create({
      data: {
        name: input.name,
        code: schoolCode,
        teacherInviteCodeHash: hashTeacherInvite(teacherInviteCode),
        status: "ACTIVE",
      },
      select: { id: true, code: true },
    });
    const replay = { schoolId: school.id, schoolCode: school.code };
    await Promise.all([
      transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName: "create_school",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          response: replay,
          resourceType: "School",
          resourceId: school.id,
        },
      }),
      transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: "create_school",
          targetType: "School",
          targetId: school.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          resultResourceId: school.id,
          traceId: context.traceId,
        },
      }),
    ]);
    return { ...replay, status: "CREATED" as const, teacherInviteCode };
  });

  return createSchoolResultSchema.parse(result);
}

export async function setSchoolStatus(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: SetSchoolStatusInput,
): Promise<SetSchoolStatusResult> {
  const input = setSchoolStatusInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashSafeRequest({
    action: "set_school_status",
    schoolId: input.schoolId,
    status: input.status,
  });

  const result = await database.$transaction(async (transaction) => {
    const existingIdempotency = await transaction.idempotencyRecord.findUnique({
      where: {
        actorId_commandName_idempotencyKey: {
          actorId: context.actorId,
          commandName: "set_school_status",
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingIdempotency) {
      requireMatchingRequest(existingIdempotency, requestHash);
      return schoolStatusReplaySchema.parse(existingIdempotency.response);
    }
    try {
      await requireActivePlatformAdmin(transaction, context.actorId);
    } catch {
      throw new SchoolAdminCommandError("FORBIDDEN");
    }
    const school = await transaction.school.findUnique({
      where: { id: input.schoolId },
      select: { id: true, status: true },
    });
    if (!school) throw new SchoolAdminCommandError("NOT_FOUND");
    const updated =
      school.status === input.status
        ? school
        : await transaction.school.update({
            where: { id: school.id },
            data: { status: input.status },
            select: { id: true, status: true },
          });
    const replay = { schoolId: updated.id, status: updated.status };
    await Promise.all([
      transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName: "set_school_status",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          response: replay,
          resourceType: "School",
          resourceId: updated.id,
        },
      }),
      transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: "set_school_status",
          targetType: "School",
          targetId: updated.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: null,
          afterVersion: null,
          resultResourceId: updated.id,
          traceId: context.traceId,
        },
      }),
    ]);
    return replay;
  });
  return setSchoolStatusResultSchema.parse(result);
}

export async function updateSchoolName(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: UpdateSchoolNameInput,
): Promise<UpdateSchoolNameResult> {
  const input = updateSchoolNameInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashSafeRequest({
    action: "update_school_name",
    schoolId: input.schoolId,
    name: input.name,
  });
  const result = await database.$transaction(async (transaction) => {
    const existingIdempotency = await transaction.idempotencyRecord.findUnique({
      where: {
        actorId_commandName_idempotencyKey: {
          actorId: context.actorId,
          commandName: "update_school_name",
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingIdempotency) {
      requireMatchingRequest(existingIdempotency, requestHash);
      return schoolNameReplaySchema.parse(existingIdempotency.response);
    }
    try {
      await requireActivePlatformAdmin(transaction, context.actorId);
    } catch {
      throw new SchoolAdminCommandError("FORBIDDEN");
    }
    const school = await transaction.school.findUnique({
      where: { id: input.schoolId },
      select: { id: true, name: true },
    });
    if (!school) throw new SchoolAdminCommandError("NOT_FOUND");
    const updated =
      school.name === input.name
        ? school
        : await transaction.school.update({
            where: { id: school.id },
            data: { name: input.name },
            select: { id: true, name: true },
          });
    const replay = { schoolId: updated.id, name: updated.name };
    await Promise.all([
      transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName: "update_school_name",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          response: replay,
          resourceType: "School",
          resourceId: updated.id,
        },
      }),
      transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: "update_school_name",
          targetType: "School",
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
  return updateSchoolNameResultSchema.parse(result);
}

export async function resetSchoolTeacherInvite(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: ResetSchoolTeacherInviteInput,
  randomness: SchoolCommandRandomness = defaultRandomness,
): Promise<ResetSchoolTeacherInviteResult> {
  const input = resetSchoolTeacherInviteInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashSafeRequest({
    action: "reset_school_teacher_invite",
    schoolId: input.schoolId,
  });
  const result = await database.$transaction(async (transaction) => {
    const existingIdempotency = await transaction.idempotencyRecord.findUnique({
      where: {
        actorId_commandName_idempotencyKey: {
          actorId: context.actorId,
          commandName: "reset_school_teacher_invite",
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existingIdempotency) {
      requireMatchingRequest(existingIdempotency, requestHash);
      const replay = schoolInviteReplaySchema.parse(existingIdempotency.response);
      return { ...replay, status: "EXISTING" as const, teacherInviteCode: null };
    }
    try {
      await requireActivePlatformAdmin(transaction, context.actorId);
    } catch {
      throw new SchoolAdminCommandError("FORBIDDEN");
    }
    const school = await transaction.school.findUnique({
      where: { id: input.schoolId },
      select: { id: true, code: true },
    });
    if (!school) throw new SchoolAdminCommandError("NOT_FOUND");
    const teacherInviteCode = randomness.generateTeacherInvite();
    await transaction.school.update({
      where: { id: school.id },
      data: { teacherInviteCodeHash: hashTeacherInvite(teacherInviteCode) },
      select: { id: true },
    });
    const replay = { schoolId: school.id, schoolCode: school.code };
    await Promise.all([
      transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName: "reset_school_teacher_invite",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          response: replay,
          resourceType: "School",
          resourceId: school.id,
        },
      }),
      transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: "reset_school_teacher_invite",
          targetType: "School",
          targetId: school.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          resultResourceId: school.id,
          traceId: context.traceId,
        },
      }),
    ]);
    return { ...replay, status: "CREATED" as const, teacherInviteCode };
  });
  return resetSchoolTeacherInviteResultSchema.parse(result);
}
