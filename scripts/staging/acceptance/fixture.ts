import type { createDatabaseClient } from "../../../src/server/db/client";

type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export type NamespaceProbe = "ABSENT" | "MATCHING" | "COLLISION";

export async function probeAcceptanceNamespace(
  database: DatabaseClient,
  classroomId: string,
  classroomName: string,
  teacherSubject: string,
  studentSubject: string,
): Promise<NamespaceProbe> {
  const classroom = await database.classroom.findUnique({
    where: { id: classroomId },
    select: {
      name: true,
      manager: { select: { authSubject: true } },
      memberships: {
        select: {
          student: { select: { authSubject: true } },
          endedAt: true,
        },
      },
    },
  });
  if (!classroom) return "ABSENT";
  const matching = classroom.name === classroomName &&
    classroom.manager.authSubject === teacherSubject &&
    classroom.memberships.length === 1 &&
    classroom.memberships[0]?.student.authSubject === studentSubject &&
    classroom.memberships[0].endedAt === null;
  return matching ? "MATCHING" : "COLLISION";
}

export async function assertNoAcceptanceBusinessHistory(
  database: DatabaseClient,
  teacherSubject: string,
  activityTitle: string,
): Promise<void> {
  const count = await database.activityDraft.count({
    where: {
      title: activityTitle,
      owner: { authSubject: teacherSubject },
    },
  });
  if (count !== 0) {
    throw new Error("STAGING_ACCEPTANCE_BUSINESS_HISTORY_ALREADY_EXISTS");
  }
}
