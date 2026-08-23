import { z } from "zod";
import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client";

const clerkSubjectSchema = z
  .string()
  .trim()
  .min(6)
  .max(200)
  .regex(
    /^user_[A-Za-z0-9]+$/,
    "Expected a Clerk user ID beginning with user_",
  );
const displayNameSchema = z.string().trim().min(1).max(120);

export const bootstrapClerkClassroomInputSchema = z
  .object({
    teacherAuthSubject: clerkSubjectSchema,
    teacherDisplayName: displayNameSchema,
    studentAuthSubject: clerkSubjectSchema,
    studentDisplayName: displayNameSchema,
    classroomId: z.uuid(),
    classroomName: z.string().trim().min(1).max(120),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.teacherAuthSubject === input.studentAuthSubject) {
      context.addIssue({
        code: "custom",
        message: "Teacher and student Clerk user IDs must differ",
        path: ["studentAuthSubject"],
      });
    }
  });

const creationStatusSchema = z.enum(["CREATED", "EXISTING"]);

export const bootstrapClerkClassroomResultSchema = z
  .object({
    teacher: z
      .object({
        id: z.uuid(),
        status: creationStatusSchema,
      })
      .strict(),
    student: z
      .object({
        id: z.uuid(),
        status: creationStatusSchema,
      })
      .strict(),
    classroom: z
      .object({
        id: z.uuid(),
        status: creationStatusSchema,
      })
      .strict(),
    membership: z
      .object({
        id: z.uuid(),
        status: creationStatusSchema,
      })
      .strict(),
  })
  .strict();

export type BootstrapClerkClassroomInput = z.input<
  typeof bootstrapClerkClassroomInputSchema
>;
export type BootstrapClerkClassroomResult = z.infer<
  typeof bootstrapClerkClassroomResultSchema
>;

type BootstrapResource =
  | "teacher"
  | "student"
  | "classroom"
  | "membership";

export class BootstrapClerkClassroomError extends Error {
  constructor(
    public readonly code:
      | "USER_ROLE_CONFLICT"
      | "USER_PROFILE_CONFLICT"
      | "CLASSROOM_MANAGER_CONFLICT"
      | "CLASSROOM_NAME_CONFLICT"
      | "MEMBERSHIP_INTERVAL_CONFLICT"
      | "CONCURRENT_WRITE",
    public readonly resource: BootstrapResource,
  ) {
    super(code);
    this.name = "BootstrapClerkClassroomError";
  }
}

type BootstrapInput = z.infer<typeof bootstrapClerkClassroomInputSchema>;
type BootstrapStatus = z.infer<typeof creationStatusSchema>;

function resolveNow(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Bootstrap clock returned an invalid date");
  }
  return new Date(value.getTime());
}

async function acquireBootstrapLocks(
  transaction: Prisma.TransactionClient,
  input: BootstrapInput,
): Promise<void> {
  const lockKeys = [
    `app-user:${input.teacherAuthSubject}`,
    `app-user:${input.studentAuthSubject}`,
    `classroom:${input.classroomId}`,
    `membership:${input.classroomId}:${input.studentAuthSubject}`,
  ].sort();

  for (const lockKey of lockKeys) {
    await transaction.$queryRaw`
      SELECT 1 AS acquired
      FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
  }
}

async function ensureUser(
  transaction: Prisma.TransactionClient,
  input: {
    authSubject: string;
    displayName: string;
    role: "TEACHER" | "STUDENT";
    resource: "teacher" | "student";
  },
  now: Date,
): Promise<{ id: string; status: BootstrapStatus }> {
  const existing = await transaction.appUser.findUnique({
    where: { authSubject: input.authSubject },
    select: { id: true, role: true, displayName: true },
  });

  if (existing) {
    if (existing.role !== input.role) {
      throw new BootstrapClerkClassroomError(
        "USER_ROLE_CONFLICT",
        input.resource,
      );
    }
    if (existing.displayName !== input.displayName) {
      throw new BootstrapClerkClassroomError(
        "USER_PROFILE_CONFLICT",
        input.resource,
      );
    }
    return { id: existing.id, status: "EXISTING" };
  }

  const created = await transaction.appUser.create({
    data: {
      authSubject: input.authSubject,
      displayName: input.displayName,
      role: input.role,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  return { id: created.id, status: "CREATED" };
}

async function runBootstrapTransaction(
  database: PrismaClient,
  input: BootstrapInput,
  now: Date,
): Promise<BootstrapClerkClassroomResult> {
  return database.$transaction(
    async (transaction) => {
      await acquireBootstrapLocks(transaction, input);

      const teacher = await ensureUser(
        transaction,
        {
          authSubject: input.teacherAuthSubject,
          displayName: input.teacherDisplayName,
          role: "TEACHER",
          resource: "teacher",
        },
        now,
      );
      const student = await ensureUser(
        transaction,
        {
          authSubject: input.studentAuthSubject,
          displayName: input.studentDisplayName,
          role: "STUDENT",
          resource: "student",
        },
        now,
      );

      const existingClassroom = await transaction.classroom.findUnique({
        where: { id: input.classroomId },
        select: { id: true, managerId: true, name: true },
      });
      let classroomStatus: BootstrapStatus;
      if (existingClassroom) {
        if (existingClassroom.managerId !== teacher.id) {
          throw new BootstrapClerkClassroomError(
            "CLASSROOM_MANAGER_CONFLICT",
            "classroom",
          );
        }
        if (existingClassroom.name !== input.classroomName) {
          throw new BootstrapClerkClassroomError(
            "CLASSROOM_NAME_CONFLICT",
            "classroom",
          );
        }
        classroomStatus = "EXISTING";
      } else {
        await transaction.classroom.create({
          data: {
            id: input.classroomId,
            name: input.classroomName,
            managerId: teacher.id,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        });
        classroomStatus = "CREATED";
      }

      const currentMembership =
        await transaction.classroomMembership.findFirst({
          where: {
            classroomId: input.classroomId,
            studentId: student.id,
            joinedAt: { lte: now },
            OR: [{ endedAt: null }, { endedAt: { gt: now } }],
          },
          orderBy: { joinedAt: "desc" },
          select: { id: true, joinedAt: true },
        });

      let membership: {
        id: string;
        joinedAt: Date;
        status: BootstrapStatus;
      };
      if (currentMembership) {
        membership = { ...currentMembership, status: "EXISTING" };
      } else {
        const futureMembership =
          await transaction.classroomMembership.findFirst({
            where: {
              classroomId: input.classroomId,
              studentId: student.id,
              joinedAt: { gt: now },
            },
            select: { id: true },
          });
        if (futureMembership) {
          throw new BootstrapClerkClassroomError(
            "MEMBERSHIP_INTERVAL_CONFLICT",
            "membership",
          );
        }

        const createdMembership =
          await transaction.classroomMembership.create({
            data: {
              classroomId: input.classroomId,
              studentId: student.id,
              joinedAt: now,
            },
            select: { id: true, joinedAt: true },
          });
        membership = { ...createdMembership, status: "CREATED" };
      }

      return bootstrapClerkClassroomResultSchema.parse({
        teacher: {
          id: teacher.id,
          status: teacher.status,
        },
        student: {
          id: student.id,
          status: student.status,
        },
        classroom: {
          id: input.classroomId,
          status: classroomStatus,
        },
        membership: {
          id: membership.id,
          status: membership.status,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}

export async function bootstrapClerkClassroom(
  database: PrismaClient,
  rawInput: BootstrapClerkClassroomInput,
  clock: () => Date = () => new Date(),
): Promise<BootstrapClerkClassroomResult> {
  const input = bootstrapClerkClassroomInputSchema.parse(rawInput);
  const now = resolveNow(clock);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runBootstrapTransaction(database, input, now);
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002");

      if (retryable && attempt < 3) {
        continue;
      }
      if (error instanceof BootstrapClerkClassroomError) {
        throw error;
      }
      if (retryable) {
        throw new BootstrapClerkClassroomError(
          "CONCURRENT_WRITE",
          "membership",
        );
      }
      throw error;
    }
  }

  throw new BootstrapClerkClassroomError(
    "CONCURRENT_WRITE",
    "membership",
  );
}
