import { randomUUID } from "node:crypto";
import { Client } from "pg";

import { afterAll, describe, expect, it } from "vitest";

import {
  bootstrapLocalStaging,
  stagingLocalIdentifier,
} from "../../src/server/bootstrap/bootstrap-local-staging";
import { createDatabaseClient } from "../../src/server/db/client";
import {
  acceptanceNamespace,
  acceptanceOtherStudentDisplayName,
  acceptanceOtherTeacherDisplayName,
  acceptanceStudentDisplayName,
  acceptanceTeacherDisplayName,
} from "./acceptance/contracts";
import {
  assertNoAcceptanceBusinessHistory,
  probeAcceptanceNamespace,
} from "./acceptance/fixture";
import {
  isPassingSessionCleanupEvidence,
  revokeAcceptanceSessions,
} from "./acceptance/cleanup";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const primarySchoolCode = "SCHTST23";
const secondarySchoolCode = "SCHTST45";
const password = "Cdas-acceptance-test9a";

function fixture() {
  const marker = `cdas-staging-${randomUUID().replaceAll("-", "")}`;
  const namespace = acceptanceNamespace(marker);
  const suffix = randomUUID().replaceAll("-", "");
  const teacherStaffNo = `T-${suffix.slice(0, 12)}`.toUpperCase();
  const otherTeacherStaffNo = `O-${suffix.slice(12, 24)}`.toUpperCase();
  const studentNo = suffix.replaceAll(/[a-f]/gu, "7").slice(0, 12);
  const otherStudentNo = suffix.replaceAll(/[a-f]/gu, "8").slice(12, 24);
  const teacherIdentifier = stagingLocalIdentifier({
    schoolCode: primarySchoolCode,
    role: "TEACHER",
    staffNo: teacherStaffNo,
  });
  const studentIdentifier = stagingLocalIdentifier({
    schoolCode: primarySchoolCode,
    role: "STUDENT",
    studentNo,
  });
  const otherStudentIdentifier = stagingLocalIdentifier({
    schoolCode: primarySchoolCode,
    role: "STUDENT",
    studentNo: otherStudentNo,
  });
  const otherTeacherIdentifier = stagingLocalIdentifier({
    schoolCode: secondarySchoolCode,
    role: "TEACHER",
    staffNo: otherTeacherStaffNo,
  });
  return {
    namespace,
    teacherIdentifier,
    studentIdentifier,
    otherStudentIdentifier,
    input: {
      schools: [
        {
          code: primarySchoolCode,
          name: "CDAS Acceptance Test School A",
          status: "ACTIVE" as const,
        },
        {
          code: secondarySchoolCode,
          name: "CDAS Acceptance Test School B",
          status: "ACTIVE" as const,
        },
      ],
      identities: [
        {
          schoolCode: primarySchoolCode,
          identifier: teacherIdentifier,
          password,
          displayName: acceptanceTeacherDisplayName,
          role: "TEACHER" as const,
          staffNo: teacherStaffNo,
        },
        {
          schoolCode: primarySchoolCode,
          identifier: studentIdentifier,
          password,
          displayName: acceptanceStudentDisplayName,
          role: "STUDENT" as const,
          studentNo,
        },
        {
          schoolCode: primarySchoolCode,
          identifier: otherStudentIdentifier,
          password,
          displayName: acceptanceOtherStudentDisplayName,
          role: "STUDENT" as const,
          studentNo: otherStudentNo,
        },
        {
          schoolCode: secondarySchoolCode,
          identifier: otherTeacherIdentifier,
          password,
          displayName: acceptanceOtherTeacherDisplayName,
          role: "TEACHER" as const,
          staffNo: otherTeacherStaffNo,
        },
      ],
      classroom: {
        id: namespace.classroomId,
        name: namespace.classroomName,
        teacherIdentifier,
        studentIdentifiers: [studentIdentifier, otherStudentIdentifier],
      },
    },
  };
}

describeWithDatabase("staging synthetic acceptance bootstrap", () => {
  afterAll(async () => database?.$disconnect());

  it("only appends a namespace and safely re-enters the exact same fixture", async () => {
    const current = fixture();
    await expect(probeAcceptanceNamespace(
      database!,
      current.namespace.classroomId,
      current.namespace.classroomName,
      current.teacherIdentifier,
      current.studentIdentifier,
      current.otherStudentIdentifier,
    )).resolves.toBe("ABSENT");

    const first = await bootstrapLocalStaging(database!, current.input);
    const teacher = await database!.localCredential.findUniqueOrThrow({
      where: { identifier: current.teacherIdentifier },
      select: { userId: true },
    });
    const sessionId = randomUUID();
    await database!.authSession.create({
      data: {
        id: sessionId,
        userId: teacher.userId,
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "a"),
        expiresAt: new Date("2026-09-02T00:00:00.000Z"),
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
    const repeated = await bootstrapLocalStaging(database!, current.input);
    expect(first.classroom).toBe("CREATED");
    expect(first.memberships).toBe(2);
    expect(repeated.classroom).toBe("EXISTING");
    expect(repeated.memberships).toBe(0);
    expect(Object.values(repeated.identities)).toEqual([
      "EXISTING",
      "EXISTING",
      "EXISTING",
      "EXISTING",
    ]);
    await expect(database!.authSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { revokedAt: true },
    })).resolves.toEqual({ revokedAt: expect.any(Date) });
    await expect(probeAcceptanceNamespace(
      database!,
      current.namespace.classroomId,
      current.namespace.classroomName,
      current.teacherIdentifier,
      current.studentIdentifier,
      current.otherStudentIdentifier,
    )).resolves.toBe("MATCHING");
  });

  it("fails closed on a derived namespace collision without reassigning it", async () => {
    const current = fixture();
    const school = await database!.school.upsert({
      where: { code: primarySchoolCode },
      create: {
        code: primarySchoolCode,
        name: "CDAS Acceptance Test School A",
        status: "ACTIVE",
        teacherInviteCodeHash: "a".repeat(64),
      },
      update: {},
    });
    const foreignId = randomUUID();
    const foreign = await database!.appUser.create({
      data: {
        id: foreignId,
        authSubject: `local:${foreignId}`,
        displayName: "Foreign staging manager",
        role: "TEACHER",
        schoolId: school.id,
        staffNo: `F-${randomUUID().slice(0, 8)}`.toUpperCase(),
      },
    });
    await database!.classroom.create({
      data: {
        id: current.namespace.classroomId,
        name: current.namespace.classroomName,
        managerId: foreign.id,
        schoolId: school.id,
      },
    });
    await expect(bootstrapLocalStaging(database!, current.input)).rejects.toThrow(
      "CLASSROOM_MANAGER_CONFLICT",
    );
    await expect(database!.classroom.findUniqueOrThrow({
      where: { id: current.namespace.classroomId },
      select: { managerId: true },
    })).resolves.toEqual({ managerId: foreign.id });
  });

  it("rejects a same-marker retry after any browser business history exists", async () => {
    const current = fixture();
    await bootstrapLocalStaging(database!, current.input);
    const teacher = await database!.localCredential.findUniqueOrThrow({
      where: { identifier: current.teacherIdentifier },
      select: { userId: true },
    });
    await database!.activityDraft.create({
      data: {
        ownerId: teacher.userId,
        status: "EDITING",
        version: 1,
        title: current.namespace.activityTitle,
        summary: current.namespace.activitySummary,
        taskInstructions: "Synthetic retry guard fixture",
        revisions: {
          create: {
            version: 1,
            source: "MANUAL",
            title: current.namespace.activityTitle,
            summary: current.namespace.activitySummary,
            taskInstructions: "Synthetic retry guard fixture",
          },
        },
      },
    });
    await expect(assertNoAcceptanceBusinessHistory(
      database!,
      current.teacherIdentifier,
      current.namespace.activityTitle,
    )).rejects.toThrow("STAGING_ACCEPTANCE_BUSINESS_HISTORY_ALREADY_EXISTS");
  });

  it("revokes all six configured sessions and leaves a partial run unchanged", async () => {
    const current = fixture();
    const disabledAccountStudentNo = `9${randomUUID().replaceAll(/[^0-9]/gu, "7").slice(0, 11)}`;
    const disabledSchoolCode = "SCHTST67";
    const disabledSchoolTeacherStaffNo = `D-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const disabledAccountIdentifier = stagingLocalIdentifier({
      schoolCode: primarySchoolCode,
      role: "STUDENT",
      studentNo: disabledAccountStudentNo,
    });
    const disabledSchoolIdentifier = stagingLocalIdentifier({
      schoolCode: disabledSchoolCode,
      role: "TEACHER",
      staffNo: disabledSchoolTeacherStaffNo,
    });
    const input = {
      ...current.input,
      schools: [
        ...current.input.schools,
        {
          code: disabledSchoolCode,
          name: "CDAS Acceptance Test Disabled School",
          status: "DISABLED" as const,
        },
      ],
      identities: [
        ...current.input.identities,
        {
          schoolCode: primarySchoolCode,
          identifier: disabledAccountIdentifier,
          password,
          displayName: "CDAS Acceptance Test Disabled Account",
          role: "STUDENT" as const,
          studentNo: disabledAccountStudentNo,
          accountStatus: "DISABLED" as const,
        },
        {
          schoolCode: disabledSchoolCode,
          identifier: disabledSchoolIdentifier,
          password,
          displayName: "CDAS Acceptance Test Disabled School Teacher",
          role: "TEACHER" as const,
          staffNo: disabledSchoolTeacherStaffNo,
        },
      ],
    };
    await bootstrapLocalStaging(database!, input);
    const identifiers = [
      current.teacherIdentifier,
      current.studentIdentifier,
      current.otherStudentIdentifier,
      current.input.identities[3].identifier,
      disabledAccountIdentifier,
      disabledSchoolIdentifier,
    ];
    const userIds = await Promise.all(identifiers.map(async (identifier) =>
      (await database!.localCredential.findUniqueOrThrow({
        where: { identifier },
        select: { userId: true },
      })).userId,
    ));
    await Promise.all(userIds.map((userId, index) => database!.authSession.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: `${index}${randomUUID().replaceAll("-", "")}`.padEnd(64, "0"),
        expiresAt: new Date("2026-09-02T00:00:00.000Z"),
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    })));
    const cleanupClient = new Client({ connectionString: databaseUrl! });
    await cleanupClient.connect();
    try {
      await expect(revokeAcceptanceSessions(cleanupClient, identifiers.slice(0, 5)))
        .rejects.toThrow("STAGING_ACCEPTANCE_LOCAL_IDENTITIES_INCOMPLETE");
      await expect(database!.authSession.count({
        where: { userId: { in: userIds }, revokedAt: null },
      })).resolves.toBe(6);
      const evidence = await revokeAcceptanceSessions(cleanupClient, identifiers);
      expect(isPassingSessionCleanupEvidence(evidence)).toBe(true);
      expect(evidence.revokedCount).toBe(6);
      await expect(database!.authSession.count({
        where: { userId: { in: userIds }, revokedAt: null },
      })).resolves.toBe(0);
    } finally {
      await cleanupClient.end();
    }
  });
});
