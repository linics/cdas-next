import "server-only";

import { z } from "zod";
import { rosterKeySchema } from "../../domain/classroom/roster-key";
import {
  MAX_ROSTER_IMPORT_ROWS,
  studentRosterEntrySchema,
} from "../../domain/classroom/student-roster-xlsx";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import {
  type ClassifiedImportRow,
  classifyStudentImportRows,
} from "../classroom/student-import-classification";
import { assertActiveBusinessActor } from "../school/teacher-authorization";

const classroomInputSchema = z.object({ classroomId: z.uuid() }).strict();
const previewInputSchema = classroomInputSchema
  .extend({ rosterKeys: z.array(rosterKeySchema).min(1).max(50) })
  .strict();

const studentImportPreviewInputSchema = classroomInputSchema
  .extend({
    rows: z
      .array(
        z
          .object({
            rowNumber: z.int().positive(),
            entry: studentRosterEntrySchema,
          })
          .strict(),
      )
      .max(MAX_ROSTER_IMPORT_ROWS),
  })
  .strict();

const isoDateSchema = z.iso.datetime({ offset: true });

export const teacherClassroomRosterSchema = z
  .object({
    actor: z.object({ displayName: z.string().trim().min(1) }).strict(),
    classroom: z
      .object({
        id: z.uuid(),
        name: z.string().trim().min(1),
        version: z.int().positive(),
        canDelete: z.boolean(),
      })
      .strict(),
    memberships: z.array(
      z
        .object({
          id: z.uuid(),
          studentId: z.uuid(),
          studentName: z.string().trim().min(1),
          joinedAt: isoDateSchema,
          endedAt: isoDateSchema.nullable(),
          status: z.enum(["CURRENT", "HISTORICAL", "SCHEDULED"]),
        })
        .strict(),
    ),
  })
  .strict();

export const rosterImportPreviewSchema = z
  .object({
    classroom: z
      .object({
        id: z.uuid(),
        name: z.string().trim().min(1),
        version: z.int().positive(),
      })
      .strict(),
    entries: z.array(
      z.discriminatedUnion("status", [
        z
          .object({
            rosterKey: rosterKeySchema,
            status: z.literal("READY"),
            studentId: z.uuid(),
            studentName: z.string().trim().min(1),
          })
          .strict(),
        z
          .object({
            rosterKey: rosterKeySchema,
            status: z.enum(["ALREADY_CURRENT", "INTERVAL_CONFLICT"]),
            studentId: z.uuid(),
            studentName: z.string().trim().min(1),
          })
          .strict(),
        z
          .object({
            rosterKey: rosterKeySchema,
            status: z.literal("NOT_FOUND"),
          })
          .strict(),
      ]),
    ),
  })
  .strict();

export type TeacherClassroomRoster = z.infer<
  typeof teacherClassroomRosterSchema
>;
export type RosterImportPreview = z.infer<typeof rosterImportPreviewSchema>;

export class TeacherClassroomRosterQueryError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN") {
    super(code);
    this.name = "TeacherClassroomRosterQueryError";
  }
}

async function requireManagedClassroom(
  database: PrismaClient,
  actorId: string,
  classroomId: string,
) {
  const [actor, classroom] = await Promise.all([
    database.appUser.findUnique({
      where: { id: actorId },
      select: {
        role: true,
        displayName: true,
        accountStatus: true,
        schoolId: true,
        school: { select: { status: true } },
      },
    }),
    database.classroom.findUnique({
      where: { id: classroomId },
      select: {
        id: true,
        name: true,
        version: true,
        managerId: true,
        schoolId: true,
        _count: { select: { memberships: true, releases: true } },
      },
    }),
  ]);
  if (!actor) throw new TeacherClassroomRosterQueryError("NOT_FOUND");
  try {
    assertActiveBusinessActor(actor);
  } catch {
    throw new TeacherClassroomRosterQueryError("NOT_FOUND");
  }
  if (actor.role !== "TEACHER") {
    throw new TeacherClassroomRosterQueryError("FORBIDDEN");
  }
  if (
    !classroom ||
    classroom.managerId !== actorId ||
    classroom.schoolId !== actor.schoolId
  ) {
    throw new TeacherClassroomRosterQueryError("NOT_FOUND");
  }
  return { actor, classroom };
}

export async function getTeacherClassroomRoster(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<TeacherClassroomRoster> {
  const input = classroomInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const { actor, classroom } = await requireManagedClassroom(
    database,
    context.actorId,
    input.classroomId,
  );
  const memberships = await database.classroomMembership.findMany({
    where: { classroomId: classroom.id },
    orderBy: [{ joinedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      studentId: true,
      joinedAt: true,
      endedAt: true,
      student: { select: { displayName: true } },
    },
  });
  return teacherClassroomRosterSchema.parse({
    actor: { displayName: actor.displayName },
    classroom: {
      id: classroom.id,
      name: classroom.name,
      version: classroom.version,
      canDelete:
        classroom._count.memberships === 0 && classroom._count.releases === 0,
    },
    memberships: memberships.map((membership) => ({
      id: membership.id,
      studentId: membership.studentId,
      studentName: membership.student.displayName,
      joinedAt: membership.joinedAt.toISOString(),
      endedAt: membership.endedAt?.toISOString() ?? null,
      status:
        membership.joinedAt > context.now
          ? "SCHEDULED"
          : membership.endedAt === null || membership.endedAt > context.now
            ? "CURRENT"
            : "HISTORICAL",
    })),
  });
}

export async function previewTeacherRosterImport(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<RosterImportPreview> {
  const input = previewInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const { classroom } = await requireManagedClassroom(
    database,
    context.actorId,
    input.classroomId,
  );
  const keys = [...new Set(input.rosterKeys)];
  const students = await database.appUser.findMany({
    where: {
      role: "STUDENT",
      accountStatus: "ACTIVE",
      schoolId: classroom.schoolId,
      rosterKey: { in: keys },
    },
    select: {
      id: true,
      displayName: true,
      rosterKey: true,
      memberships: {
        where: {
          classroomId: classroom.id,
          OR: [{ endedAt: null }, { endedAt: { gt: context.now } }],
        },
        select: { joinedAt: true, endedAt: true },
      },
    },
  });
  const byKey = new Map(
    students.flatMap((student) =>
      student.rosterKey ? [[student.rosterKey, student] as const] : [],
    ),
  );
  return rosterImportPreviewSchema.parse({
    classroom: {
      id: classroom.id,
      name: classroom.name,
      version: classroom.version,
    },
    entries: keys.map((rosterKey) => {
      const student = byKey.get(rosterKey);
      if (!student) return { rosterKey, status: "NOT_FOUND" as const };
      const interval = student.memberships[0];
      const status = !interval
        ? ("READY" as const)
        : interval.joinedAt <= context.now &&
            (interval.endedAt === null || interval.endedAt > context.now)
          ? ("ALREADY_CURRENT" as const)
          : ("INTERVAL_CONFLICT" as const);
      return {
        rosterKey,
        status,
        studentId: student.id,
        studentName: student.displayName,
      };
    }),
  });
}

export type StudentImportPreview = Readonly<{
  classroom: Readonly<{ id: string; name: string; version: number }>;
  rows: readonly ClassifiedImportRow[];
}>;

/**
 * Read-only report of what a parsed roster file would do to this classroom.
 * The upload action uses this report to show every row, including the ones an
 * import must refuse, and prepares an intent only from the importable subset.
 */
export async function previewStudentImport(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<StudentImportPreview> {
  const input = studentImportPreviewInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const { classroom } = await requireManagedClassroom(
    database,
    context.actorId,
    input.classroomId,
  );
  const rows = await classifyStudentImportRows(database, {
    schoolId: classroom.schoolId,
    classroomId: classroom.id,
    now: context.now,
    entries: input.rows,
  });
  return {
    classroom: {
      id: classroom.id,
      name: classroom.name,
      version: classroom.version,
    },
    rows,
  };
}
