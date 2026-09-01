import type { createDatabaseClient } from "../../../src/server/db/client";

type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export type NamespaceProbe = "ABSENT" | "MATCHING" | "COLLISION";

export async function probeAcceptanceNamespace(
  database: DatabaseClient,
  classroomId: string,
  classroomName: string,
  teacherSubject: string,
  studentSubject: string,
  otherStudentSubject: string,
): Promise<NamespaceProbe> {
  const classroom = await database.classroom.findUnique({
    where: { id: classroomId },
    select: {
      name: true,
      manager: { select: { authSubject: true, localCredential: { select: { identifier: true } } } },
      memberships: {
        select: {
          student: { select: { authSubject: true, localCredential: { select: { identifier: true } } } },
          endedAt: true,
        },
      },
    },
  });
  if (!classroom) return "ABSENT";
  const matching = classroom.name === classroomName &&
    classroom.manager.localCredential?.identifier === teacherSubject &&
    classroom.memberships.length === 2 &&
    classroom.memberships.every((membership) => membership.endedAt === null) &&
    new Set(classroom.memberships.map((membership) => membership.student.localCredential?.identifier)).size === 2 &&
    new Set(classroom.memberships.map((membership) => membership.student.localCredential?.identifier)).has(studentSubject) &&
    new Set(classroom.memberships.map((membership) => membership.student.localCredential?.identifier)).has(otherStudentSubject);
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
      owner: { localCredential: { identifier: teacherSubject } },
    },
  });
  if (count !== 0) {
    throw new Error("STAGING_ACCEPTANCE_BUSINESS_HISTORY_ALREADY_EXISTS");
  }
}
