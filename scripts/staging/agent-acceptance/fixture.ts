import type { createDatabaseClient } from "../../../src/server/db/client";

type DatabaseClient = ReturnType<typeof createDatabaseClient>;
export type AgentNamespaceProbe = "ABSENT" | "MATCHING" | "COLLISION";

export async function probeAgentNamespace(
  database: DatabaseClient,
  classroomId: string,
  classroomName: string,
  teacherIdentifier: string,
  studentIdentifier: string,
  otherStudentIdentifier: string,
): Promise<AgentNamespaceProbe> {
  const classroom = await database.classroom.findUnique({
    where: { id: classroomId },
    select: {
      name: true,
      manager: {
        select: { localCredential: { select: { identifier: true } } },
      },
      memberships: {
        select: {
          student: {
            select: { localCredential: { select: { identifier: true } } },
          },
          endedAt: true,
        },
      },
    },
  });
  if (!classroom) return "ABSENT";
  const identifiers = new Set(
    classroom.memberships.map(
      (membership) => membership.student.localCredential?.identifier,
    ),
  );
  const matching =
    classroom.name === classroomName &&
    classroom.manager.localCredential?.identifier === teacherIdentifier &&
    classroom.memberships.length === 2 &&
    classroom.memberships.every((membership) => membership.endedAt === null) &&
    identifiers.size === 2 &&
    identifiers.has(studentIdentifier) &&
    identifiers.has(otherStudentIdentifier);
  return matching ? "MATCHING" : "COLLISION";
}

export async function assertNoAgentBusinessHistory(
  database: DatabaseClient,
  teacherIdentifier: string,
  activityTitle: string,
): Promise<void> {
  const count = await database.activityDraft.count({
    where: {
      title: activityTitle,
      owner: { localCredential: { identifier: teacherIdentifier } },
    },
  });
  if (count !== 0) {
    throw new Error("STAGING_AGENT_ACCEPTANCE_BUSINESS_HISTORY_ALREADY_EXISTS");
  }
}
