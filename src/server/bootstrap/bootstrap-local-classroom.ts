import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { legacySchoolId } from "../../domain/school/legacy-school";
import { staffNoSchema } from "../../domain/school/identity";
import { studentIdentifier, teacherIdentifier } from "../auth/local-auth-primitives";
import { hashPassword } from "../auth/local-auth-primitives";

const inputSchema = z.object({
  teacherStaffNo: z.string().trim().min(1).max(32),
  teacherPassword: z.string().min(10),
  studentNo: z.string().regex(/^\d{6,32}$/u),
  studentPassword: z.string().min(10),
  teacherDisplayName: z.string().trim().min(1).max(120),
  studentDisplayName: z.string().trim().min(1).max(120),
  studentRosterKey: z.string().trim().min(1).max(32).optional(),
  classroomId: z.uuid(),
  classroomName: z.string().trim().min(1).max(120),
}).strict();

const statusSchema = z.enum(["CREATED", "EXISTING"]);
export const bootstrapLocalClassroomResultSchema = z.object({
  teacher: z.object({ id: z.uuid(), status: statusSchema }),
  student: z.object({ id: z.uuid(), status: statusSchema }),
  classroom: z.object({ id: z.uuid(), status: statusSchema }),
  membership: z.object({ id: z.uuid(), status: statusSchema }),
}).strict();
export type BootstrapLocalClassroomInput = z.input<typeof inputSchema>;
export type BootstrapLocalClassroomResult = z.infer<typeof bootstrapLocalClassroomResultSchema>;

export class BootstrapLocalClassroomError extends Error {
  constructor(
    public readonly code:
      | "USER_ROLE_CONFLICT"
      | "USER_PROFILE_CONFLICT"
      | "CLASSROOM_MANAGER_CONFLICT"
      | "CLASSROOM_NAME_CONFLICT"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "BootstrapLocalClassroomError";
  }
}

async function locks(
  transaction: Prisma.TransactionClient,
  keys: readonly string[],
): Promise<void> {
  for (const key of [...keys].sort()) {
    await transaction.$queryRaw`
      SELECT 1 AS acquired
      FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))
    `;
  }
}

async function ensureUser(
  transaction: Prisma.TransactionClient,
  input: {
    identifier: string;
    passwordHash: string;
    displayName: string;
    role: "TEACHER" | "STUDENT";
    rosterKey?: string;
    staffNo?: string;
    studentNo?: string;
  },
  now: Date,
): Promise<{ id: string; status: "CREATED" | "EXISTING" }> {
  const credential = await transaction.localCredential.findUnique({
    where: { identifier: input.identifier },
    select: {
      user: {
        select: {
          id: true,
          role: true,
          displayName: true,
          rosterKey: true,
          authSubject: true,
          schoolId: true,
          staffNo: true,
          studentNo: true,
        },
      },
    },
  });
  if (credential) {
    if (credential.user.role !== input.role) throw new BootstrapLocalClassroomError("USER_ROLE_CONFLICT");
    if (
      credential.user.authSubject !== `local:${credential.user.id}` ||
      credential.user.schoolId !== legacySchoolId ||
      (input.role === "TEACHER" && credential.user.staffNo !== input.staffNo) ||
      (input.role === "STUDENT" && credential.user.studentNo !== input.studentNo)
    ) {
      throw new BootstrapLocalClassroomError("USER_PROFILE_CONFLICT");
    }
    if (credential.user.displayName !== input.displayName) {
      throw new BootstrapLocalClassroomError("USER_PROFILE_CONFLICT");
    }
    if (
      input.rosterKey &&
      credential.user.rosterKey !== input.rosterKey &&
      credential.user.rosterKey
    ) {
      throw new BootstrapLocalClassroomError("USER_PROFILE_CONFLICT");
    }
    if (input.rosterKey && !credential.user.rosterKey) {
      await transaction.appUser.update({
        where: { id: credential.user.id },
        data: { rosterKey: input.rosterKey, updatedAt: now },
      });
    }
    await transaction.localCredential.update({
      where: { userId: credential.user.id },
      data: {
        passwordHash: input.passwordHash,
        mustChangePassword: false,
        passwordChangedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    // Re-entry rotates the synthetic password, so every session issued under
    // the previous credential must become unusable in the same transaction.
    await transaction.authSession.updateMany({
      where: { userId: credential.user.id, revokedAt: null },
      data: { revokedAt: now },
    });
    return { id: credential.user.id, status: "EXISTING" };
  }
  const id = randomUUID();
  await transaction.appUser.create({
    data: {
      id,
      authSubject: `local:${id}`,
      role: input.role,
      displayName: input.displayName,
      rosterKey: input.rosterKey,
      ...({ schoolId: legacySchoolId } as const),
      ...(input.role === "TEACHER"
        ? { staffNo: input.staffNo }
        : { studentNo: input.studentNo }),
      createdAt: now,
      updatedAt: now,
    },
  });
  await transaction.localCredential.create({
    data: {
      userId: id,
      identifier: input.identifier,
      passwordHash: input.passwordHash,
      mustChangePassword: false,
      passwordChangedAt: now,
    },
  });
  return { id, status: "CREATED" };
}

export async function bootstrapLocalClassroom(
  database: PrismaClient,
  rawInput: BootstrapLocalClassroomInput,
  clock: () => Date = () => new Date(),
): Promise<BootstrapLocalClassroomResult> {
  const input = inputSchema.parse(rawInput);
  const teacherStaffNo = staffNoSchema.parse(input.teacherStaffNo);
  const teacherHash = await hashPassword(input.teacherPassword);
  const studentHash = await hashPassword(input.studentPassword);
  const teacherId = teacherIdentifier("SCHARCHX", teacherStaffNo);
  const studentId = studentIdentifier("SCHARCHX", input.studentNo);
  const now = clock();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await database.$transaction(async (transaction) => {
        await locks(transaction, [
          `credential:${teacherId}`, `credential:${studentId}`,
          `classroom:${input.classroomId}`,
        ]);
        const teacher = await ensureUser(
          transaction,
          {
            identifier: teacherId,
            passwordHash: teacherHash,
            displayName: input.teacherDisplayName,
            role: "TEACHER",
            staffNo: teacherStaffNo,
          },
          now,
        );
        const student = await ensureUser(
          transaction,
          {
            identifier: studentId,
            passwordHash: studentHash,
            displayName: input.studentDisplayName,
            role: "STUDENT",
            rosterKey: input.studentRosterKey,
            studentNo: input.studentNo,
          },
          now,
        );
        const classroom = await transaction.classroom.findUnique({
          where: { id: input.classroomId },
          select: { id: true, managerId: true, name: true },
        });
        if (classroom && classroom.managerId !== teacher.id) {
          throw new BootstrapLocalClassroomError("CLASSROOM_MANAGER_CONFLICT");
        }
        if (classroom && classroom.name !== input.classroomName) {
          throw new BootstrapLocalClassroomError("CLASSROOM_NAME_CONFLICT");
        }
        if (!classroom) {
          await transaction.classroom.create({
            data: {
              id: input.classroomId,
              name: input.classroomName,
              managerId: teacher.id,
              schoolId: legacySchoolId,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
        const membership = await transaction.classroomMembership.findFirst({
          where: {
            classroomId: input.classroomId,
            studentId: student.id,
            joinedAt: { lte: now },
            OR: [{ endedAt: null }, { endedAt: { gt: now } }],
          },
          select: { id: true },
        });
        const membershipResult = membership
          ? { id: membership.id, status: "EXISTING" as const }
          : {
              id: (
                await transaction.classroomMembership.create({
                  data: {
                    classroomId: input.classroomId,
                    studentId: student.id,
                    joinedAt: now,
                  },
                  select: { id: true },
                })
              ).id,
              status: "CREATED" as const,
            };
        return bootstrapLocalClassroomResultSchema.parse({ teacher, student, classroom: { id: input.classroomId, status: classroom ? "EXISTING" : "CREATED" }, membership: membershipResult });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
    } catch (error) {
      if (error instanceof BootstrapLocalClassroomError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034") && attempt < 3) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) throw new BootstrapLocalClassroomError("CONCURRENT_WRITE");
      throw error;
    }
  }
  throw new BootstrapLocalClassroomError("CONCURRENT_WRITE");
}
