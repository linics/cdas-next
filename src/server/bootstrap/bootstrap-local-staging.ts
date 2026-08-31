import { randomUUID } from "node:crypto";
import { z } from "zod";

import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { hashTeacherInvite, schoolCodeSchema, staffNoSchema } from "../../domain/school/identity";
import { hashPassword, studentIdentifier, teacherIdentifier } from "../auth/local-auth-primitives";

const schoolSchema = z.object({
  code: schoolCodeSchema,
  name: z.string().trim().min(1).max(120),
  status: z.enum(["ACTIVE", "DISABLED"]),
}).strict();

const identitySchema = z.object({
  schoolCode: schoolCodeSchema,
  identifier: z.string().trim().min(1).max(96),
  password: z.string().min(10),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(["TEACHER", "STUDENT"]),
  staffNo: z.string().trim().optional(),
  studentNo: z.string().regex(/^\d{6,32}$/u).optional(),
  accountStatus: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
}).strict();

const inputSchema = z.object({
  schools: z.array(schoolSchema).min(1),
  identities: z.array(identitySchema).min(1),
  classroom: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    teacherIdentifier: z.string().trim().min(1).max(96),
    studentIdentifiers: z.array(z.string().trim().min(1).max(96)).min(1),
  }).strict(),
}).strict();

export type BootstrapLocalStagingInput = z.input<typeof inputSchema>;
export type BootstrapLocalStagingResult = Readonly<{
  schools: Readonly<Record<string, "CREATED" | "EXISTING">>;
  identities: Readonly<Record<string, "CREATED" | "EXISTING">>;
  classroom: "CREATED" | "EXISTING";
  memberships: number;
}>;

export class BootstrapLocalStagingError extends Error {
  constructor(public readonly code:
    | "SCHOOL_PROFILE_CONFLICT"
    | "IDENTITY_PROFILE_CONFLICT"
    | "CLASSROOM_MANAGER_CONFLICT"
    | "CLASSROOM_NAME_CONFLICT"
    | "IDENTITY_NOT_FOUND"
    | "CONCURRENT_WRITE") {
    super(code);
    this.name = "BootstrapLocalStagingError";
  }
}

async function lock(transaction: Prisma.TransactionClient, key: string): Promise<void> {
  await transaction.$queryRaw`SELECT 1 AS acquired FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export async function bootstrapLocalStaging(
  database: PrismaClient,
  rawInput: BootstrapLocalStagingInput,
  clock: () => Date = () => new Date(),
): Promise<BootstrapLocalStagingResult> {
  const input = inputSchema.parse(rawInput);
  const identities = input.identities.map((identity) => ({
    ...identity,
    schoolCode: schoolCodeSchema.parse(identity.schoolCode),
    ...(identity.role === "TEACHER" ? { staffNo: staffNoSchema.parse(identity.staffNo ?? "") } : { studentNo: identity.studentNo }),
  }));
  const hashes = await Promise.all(identities.map((identity) => hashPassword(identity.password)));
  const now = clock();
  if (Number.isNaN(now.getTime())) throw new TypeError("BOOTSTRAP_CLOCK_INVALID");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await database.$transaction(async (transaction) => {
        for (const school of input.schools) await lock(transaction, `school:${school.code}`);
        for (const identity of identities) await lock(transaction, `credential:${identity.identifier}`);
        await lock(transaction, `classroom:${input.classroom.id}`);

        const schoolIds = new Map<string, string>();
        const schoolStatuses: Record<string, "CREATED" | "EXISTING"> = {};
        for (const school of input.schools) {
          const existing = await transaction.school.findUnique({ where: { code: school.code }, select: { id: true, name: true, status: true, teacherInviteCodeHash: true } });
          if (existing) {
            if (existing.name !== school.name || existing.status !== school.status) throw new BootstrapLocalStagingError("SCHOOL_PROFILE_CONFLICT");
            schoolIds.set(school.code, existing.id);
            schoolStatuses[school.code] = "EXISTING";
          } else {
            const created = await transaction.school.create({ data: { code: school.code, name: school.name, status: school.status, teacherInviteCodeHash: hashTeacherInvite(`cdas-staging-${school.code}`), createdAt: now, updatedAt: now }, select: { id: true } });
            schoolIds.set(school.code, created.id);
            schoolStatuses[school.code] = "CREATED";
          }
        }

        const userIds = new Map<string, string>();
        const identityStatuses: Record<string, "CREATED" | "EXISTING"> = {};
        for (const [index, identity] of identities.entries()) {
          const schoolId = schoolIds.get(identity.schoolCode);
          if (!schoolId) throw new BootstrapLocalStagingError("SCHOOL_PROFILE_CONFLICT");
          const existing = await transaction.localCredential.findUnique({ where: { identifier: identity.identifier }, select: { user: { select: { id: true, authSubject: true, role: true, displayName: true, schoolId: true, staffNo: true, studentNo: true, accountStatus: true } } } });
          if (existing) {
            const user = existing.user;
            if (user.authSubject !== `local:${user.id}` || user.role !== identity.role || user.displayName !== identity.displayName || user.schoolId !== schoolId || user.accountStatus !== identity.accountStatus || (identity.role === "TEACHER" ? user.staffNo !== identity.staffNo : user.studentNo !== identity.studentNo)) throw new BootstrapLocalStagingError("IDENTITY_PROFILE_CONFLICT");
            userIds.set(identity.identifier, user.id);
            identityStatuses[identity.identifier] = "EXISTING";
            await transaction.localCredential.update({ where: { identifier: identity.identifier }, data: { passwordHash: hashes[index], mustChangePassword: false, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null } });
          } else {
            const id = randomUUID();
            await transaction.appUser.create({ data: { id, authSubject: `local:${id}`, role: identity.role, displayName: identity.displayName, schoolId, accountStatus: identity.accountStatus, ...(identity.role === "TEACHER" ? { staffNo: identity.staffNo } : { studentNo: identity.studentNo }), createdAt: now, updatedAt: now } });
            await transaction.localCredential.create({ data: { userId: id, identifier: identity.identifier, passwordHash: hashes[index], mustChangePassword: false, passwordChangedAt: now } });
            userIds.set(identity.identifier, id);
            identityStatuses[identity.identifier] = "CREATED";
          }
        }

        const teacherId = userIds.get(input.classroom.teacherIdentifier);
        if (!teacherId) throw new BootstrapLocalStagingError("IDENTITY_NOT_FOUND");
        const teacher = await transaction.appUser.findUnique({ where: { id: teacherId }, select: { id: true, role: true } });
        if (!teacher || teacher.role !== "TEACHER") throw new BootstrapLocalStagingError("IDENTITY_PROFILE_CONFLICT");
        const existingClassroom = await transaction.classroom.findUnique({ where: { id: input.classroom.id }, select: { managerId: true, name: true } });
        let classroomStatus: "CREATED" | "EXISTING" = "EXISTING";
        if (existingClassroom) {
          if (existingClassroom.managerId !== teacherId) throw new BootstrapLocalStagingError("CLASSROOM_MANAGER_CONFLICT");
          if (existingClassroom.name !== input.classroom.name) throw new BootstrapLocalStagingError("CLASSROOM_NAME_CONFLICT");
        } else {
          const teacherSchool = await transaction.appUser.findUnique({ where: { id: teacherId }, select: { schoolId: true } });
          if (!teacherSchool?.schoolId) throw new BootstrapLocalStagingError("IDENTITY_PROFILE_CONFLICT");
          await transaction.classroom.create({ data: { id: input.classroom.id, name: input.classroom.name, managerId: teacherId, schoolId: teacherSchool.schoolId, createdAt: now, updatedAt: now } });
          classroomStatus = "CREATED";
        }
        let memberships = 0;
        for (const identifier of input.classroom.studentIdentifiers) {
          const studentId = userIds.get(identifier);
          if (!studentId) throw new BootstrapLocalStagingError("IDENTITY_NOT_FOUND");
          const current = await transaction.classroomMembership.findFirst({ where: { classroomId: input.classroom.id, studentId, joinedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }] }, select: { id: true } });
          if (!current) { await transaction.classroomMembership.create({ data: { classroomId: input.classroom.id, studentId, joinedAt: now } }); memberships += 1; }
        }
        return { schools: schoolStatuses, identities: identityStatuses, classroom: classroomStatus, memberships };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 });
    } catch (error) {
      if (error instanceof BootstrapLocalStagingError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034") && attempt < 3) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) throw new BootstrapLocalStagingError("CONCURRENT_WRITE");
      throw error;
    }
  }
  throw new BootstrapLocalStagingError("CONCURRENT_WRITE");
}

export function stagingLocalIdentifier(input: Readonly<{ schoolCode: string; role: "TEACHER" | "STUDENT"; staffNo?: string; studentNo?: string }>): string {
  return input.role === "TEACHER" ? teacherIdentifier(input.schoolCode, staffNoSchema.parse(input.staffNo ?? "")) : studentIdentifier(input.schoolCode, input.studentNo ?? "");
}
