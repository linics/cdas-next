import "server-only";

import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { disciplineCodeSchema } from "../../domain/activity/activity-content";
import {
  hashTeacherInvite,
  normalizeSchoolCode,
  normalizeStaffNo,
  schoolCodeSchema,
  staffNoSchema,
} from "../../domain/school/identity";
import type { PrismaClient } from "../../generated/prisma/client";
import { hashLocalPassword, localTeacherIdentifier } from "../auth/local-auth";

const displayNameSchema = z.string().trim().min(1).max(120);
const teacherInviteCodeSchema = z.string().trim().min(16).max(200);
const passwordSchema = z.string().min(10).max(256);
const normalizedSchoolCodeSchema = z.string().transform(normalizeSchoolCode).pipe(schoolCodeSchema);
const normalizedStaffNoSchema = z.string().transform(normalizeStaffNo).pipe(staffNoSchema);

export const verifyTeacherInviteInputSchema = z.object({ schoolCode: normalizedSchoolCodeSchema, teacherInviteCode: teacherInviteCodeSchema }).strict();
export const registerTeacherInputSchema = z.object({ schoolCode: normalizedSchoolCodeSchema, teacherInviteCode: teacherInviteCodeSchema, staffNo: normalizedStaffNoSchema, displayName: displayNameSchema, primaryDisciplineCode: disciplineCodeSchema, secondaryDisciplineCodes: z.array(disciplineCodeSchema).max(14), password: passwordSchema }).strict().superRefine((value, context) => {
  if (new Set(value.secondaryDisciplineCodes).size !== value.secondaryDisciplineCodes.length) context.addIssue({ code: "custom", path: ["secondaryDisciplineCodes"], message: "Secondary disciplines must not repeat" });
  if (value.secondaryDisciplineCodes.includes(value.primaryDisciplineCode)) context.addIssue({ code: "custom", path: ["secondaryDisciplineCodes"], message: "Primary discipline cannot also be secondary" });
});
export const verifiedTeacherInviteSchema = z.object({ schoolName: displayNameSchema, schoolCode: schoolCodeSchema }).strict();
export const registerTeacherResultSchema = z.object({ teacherId: z.uuid(), status: z.enum(["CREATED", "EXISTING"]) }).strict();
export type VerifyTeacherInviteInput = z.input<typeof verifyTeacherInviteInputSchema>;
export type VerifiedTeacherInvite = z.infer<typeof verifiedTeacherInviteSchema>;
export type RegisterTeacherInput = z.input<typeof registerTeacherInputSchema>;
export type RegisterTeacherResult = z.infer<typeof registerTeacherResultSchema>;

export class TeacherRegistrationError extends Error {
  constructor(public readonly code: "INVALID_INVITE" | "STAFF_NO_TAKEN" | "PROVISIONING_CONFLICT" | "CONCURRENT_WRITE") {
    super(code);
    this.name = "TeacherRegistrationError";
  }
}

type RegistrationInput = z.infer<typeof registerTeacherInputSchema>;

function registrationRequestHash(input: RegistrationInput): string {
  const value = canonicalize({ action: "register_teacher", schoolCode: input.schoolCode, staffNo: input.staffNo, displayName: input.displayName, primaryDisciplineCode: input.primaryDisciplineCode, secondaryDisciplineCodes: input.secondaryDisciplineCodes });
  if (value === undefined) throw new TypeError("Teacher registration cannot be canonicalized");
  return createHash("sha256").update(value).digest("hex");
}

async function findActiveSchoolForInvite(database: Pick<PrismaClient, "school">, schoolCode: string, teacherInviteCode: string) {
  return database.school.findFirst({ where: { code: schoolCode, status: "ACTIVE", teacherInviteCodeHash: hashTeacherInvite(teacherInviteCode) }, select: { id: true, name: true, code: true } });
}

export async function verifyTeacherInvite(database: PrismaClient, rawInput: VerifyTeacherInviteInput): Promise<VerifiedTeacherInvite | null> {
  const input = verifyTeacherInviteInputSchema.parse(rawInput);
  const school = await findActiveSchoolForInvite(database, input.schoolCode, input.teacherInviteCode);
  return school ? verifiedTeacherInviteSchema.parse({ schoolName: school.name, schoolCode: school.code }) : null;
}

function sameProfile(existing: { displayName: string; primaryDisciplineCode: string | null; secondaryDisciplineCodes: readonly string[] }, input: RegistrationInput): boolean {
  return existing.displayName === input.displayName && existing.primaryDisciplineCode === input.primaryDisciplineCode && existing.secondaryDisciplineCodes.length === input.secondaryDisciplineCodes.length && existing.secondaryDisciplineCodes.every((code, index) => code === input.secondaryDisciplineCodes[index]);
}

/**
 * Creates the teacher business user, local credential and provisioning audit in
 * one database transaction. Unlike the previous Clerk flow there is no
 * cross-service compensation window and no password ever leaves PostgreSQL.
 */
export async function registerTeacher(database: PrismaClient, rawInput: RegisterTeacherInput): Promise<RegisterTeacherResult> {
  const input = registerTeacherInputSchema.parse(rawInput);
  const passwordHash = await hashLocalPassword(input.password);
  const requestHash = registrationRequestHash(input);
  const identifier = localTeacherIdentifier(input.schoolCode, input.staffNo);

  const result = await database.$transaction(async (transaction) => {
    const school = await findActiveSchoolForInvite(transaction, input.schoolCode, input.teacherInviteCode);
    if (!school) throw new TeacherRegistrationError("INVALID_INVITE");
    const existing = await transaction.appUser.findUnique({ where: { schoolId_staffNo: { schoolId: school.id, staffNo: input.staffNo } }, select: { id: true, role: true, displayName: true, primaryDisciplineCode: true, secondaryDisciplineCodes: true } });
    if (existing) {
      if (existing.role !== "TEACHER") throw new TeacherRegistrationError("CONCURRENT_WRITE");
      if (!sameProfile(existing, input)) throw new TeacherRegistrationError("STAFF_NO_TAKEN");
      return { teacherId: existing.id, status: "EXISTING" as const };
    }
    const existingProvisioning = await transaction.teacherProvisioning.findUnique({ where: { schoolId_staffNo: { schoolId: school.id, staffNo: input.staffNo } }, select: { id: true, appUserId: true, displayName: true, primaryDisciplineCode: true, secondaryDisciplineCodes: true } });
    if (existingProvisioning) {
      if (existingProvisioning.appUserId && sameProfile(existingProvisioning, input)) return { teacherId: existingProvisioning.appUserId, status: "EXISTING" as const };
      throw new TeacherRegistrationError("PROVISIONING_CONFLICT");
    }

    const teacherId = randomUUID();
    await transaction.appUser.create({ data: { id: teacherId, authSubject: `local:${teacherId}`, role: "TEACHER", displayName: input.displayName, schoolId: school.id, staffNo: input.staffNo, primaryDisciplineCode: input.primaryDisciplineCode, secondaryDisciplineCodes: input.secondaryDisciplineCodes, accountStatus: "ACTIVE", legacyProfile: false } });
    await Promise.all([
      transaction.localCredential.create({ data: { userId: teacherId, identifier, passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } }),
      transaction.teacherProvisioning.create({ data: { schoolId: school.id, staffNo: input.staffNo, displayName: input.displayName, primaryDisciplineCode: input.primaryDisciplineCode, secondaryDisciplineCodes: input.secondaryDisciplineCodes, identityIdentifier: identifier, identitySubject: `local:${teacherId}`, appUserId: teacherId, status: "COMPLETED", completedAt: new Date() } }),
      transaction.actionAudit.create({ data: { actorId: teacherId, source: "SYSTEM", actionName: "register_teacher", targetType: "AppUser", targetId: teacherId, requestHash, outcome: "SUCCEEDED", resultResourceId: teacherId, traceId: "teacher-registration" } }),
    ]);
    return { teacherId, status: "CREATED" as const };
  });
  return registerTeacherResultSchema.parse(result);
}
