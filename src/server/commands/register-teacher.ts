import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  hashTeacherInvite,
  normalizeSchoolCode,
  normalizeStaffNo,
  schoolCodeSchema,
  staffNoSchema,
} from "../../domain/school/identity";
import { hashPassword } from "../auth/local-auth";

const inputSchema = z.object({
  schoolCode: schoolCodeSchema,
  inviteCode: z.string().trim().min(1).max(256),
  staffNo: staffNoSchema,
  displayName: z.string().trim().min(1).max(120),
  password: z.string(),
}).strict();

export type RegisterTeacherInput = z.input<typeof inputSchema>;
export type RegisterTeacherResult = { teacherId: string; provisioningId: string; status: "CREATED" | "CLAIMED" };

export class RegisterTeacherError extends Error {
  constructor(public readonly code: "INVALID_INVITE" | "SCHOOL_DISABLED" | "CONFLICT" | "CONCURRENT_WRITE") {
    super(code);
    this.name = "RegisterTeacherError";
  }
}

export async function registerTeacherWithInvite(
  database: PrismaClient,
  rawInput: RegisterTeacherInput,
): Promise<RegisterTeacherResult> {
  const input = inputSchema.parse(rawInput);
  const passwordHash = await hashPassword(input.password);
  const identifier = `teacher:${normalizeSchoolCode(input.schoolCode).toLowerCase()}:${normalizeStaffNo(input.staffNo).toLowerCase()}`;
  const inviteHash = hashTeacherInvite(input.inviteCode);
  const now = new Date();
  const execute = async () => database.$transaction(async (transaction) => {
    const school = await transaction.school.findUnique({
      where: { code: normalizeSchoolCode(input.schoolCode) },
      select: {
        id: true,
        code: true,
        status: true,
        teacherInviteCodeHash: true,
      },
    });
    if (!school) throw new RegisterTeacherError("INVALID_INVITE");
    if (school.status !== "ACTIVE") throw new RegisterTeacherError("SCHOOL_DISABLED");
    if (!timingSafeEqual(
      Buffer.from(inviteHash, "hex"),
      Buffer.from(school.teacherInviteCodeHash, "hex"),
    )) {
      throw new RegisterTeacherError("INVALID_INVITE");
    }
    const existing = await transaction.appUser.findFirst({
      where: {
        role: "TEACHER",
        schoolId: school.id,
        staffNo: normalizeStaffNo(input.staffNo),
      },
      select: {
        id: true,
        authSubject: true,
        displayName: true,
        teacherProvisioning: { select: { id: true, status: true } },
        localCredential: { select: { id: true } },
      },
    });
    if (existing) {
      const provisioning = existing.teacherProvisioning;
      if (
        existing.localCredential ||
        provisioning?.status !== "PENDING" ||
        existing.authSubject !== `pending:${provisioning?.id}`
      ) {
        throw new RegisterTeacherError("CONFLICT");
      }
    }
    const teacherId = existing?.id ?? randomUUID();
    const provisioningId = existing?.teacherProvisioning?.id ?? randomUUID();
    if (existing) {
      await transaction.appUser.update({ where: { id: existing.id }, data: { authSubject: `local:${existing.id}` } });
      await transaction.localCredential.create({
        data: {
          userId: existing.id,
          identifier,
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: now,
        },
      });
      await transaction.teacherProvisioning.update({
        where: { id: provisioningId },
        data: { status: "COMPLETED", completedAt: now },
      });
    } else {
      await transaction.appUser.create({
        data: {
          id: teacherId,
          authSubject: `local:${teacherId}`,
          role: "TEACHER",
          displayName: input.displayName,
          schoolId: school.id,
          staffNo: normalizeStaffNo(input.staffNo),
          accountStatus: "ACTIVE",
          legacyProfile: false,
        },
      });
      await transaction.localCredential.create({
        data: {
          userId: teacherId,
          identifier,
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: now,
        },
      });
      await transaction.teacherProvisioning.create({
        data: {
          id: provisioningId,
          schoolId: school.id,
          staffNo: normalizeStaffNo(input.staffNo),
          displayName: input.displayName,
          appUserId: teacherId,
          status: "COMPLETED",
          completedAt: now,
        },
      });
    }
    const requestHash = createHash("sha256").update(`${identifier}:${school.id}`).digest("hex");
    await transaction.actionAudit.create({
      data: {
        actorId: teacherId,
        source: "UI",
        actionName: "register_teacher",
        targetType: "AppUser",
        targetId: teacherId,
        requestHash,
        outcome: "SUCCEEDED",
        resultResourceId: teacherId,
        traceId: randomUUID(),
      },
    });
    return {
      teacherId,
      provisioningId,
      status: existing ? ("CLAIMED" as const) : ("CREATED" as const),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new RegisterTeacherError("CONFLICT");
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 3
      ) {
        continue;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        throw new RegisterTeacherError("CONCURRENT_WRITE");
      }
      throw error;
    }
  }
  throw new RegisterTeacherError("CONCURRENT_WRITE");
}
