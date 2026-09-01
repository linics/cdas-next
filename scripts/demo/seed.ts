import { randomBytes, randomUUID } from "node:crypto";
import nextEnvironment from "@next/env";
import type { ActivityContentV3 } from "../../src/domain/activity/activity-content";
import { demoActivitiesV3 } from "../../src/fixtures/demo-activities";
import type { TeacherEvaluationOutcome } from "../../src/domain/evaluation/teacher-evaluation-intent";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { createDatabaseClient } from "../../src/server/db/client";
import {
  bootstrapLocalStaging,
  stagingLocalIdentifier,
} from "../../src/server/bootstrap/bootstrap-local-staging";
import {
  resolveBootstrapDatabaseTarget,
  serializeBootstrapAdminCliError,
} from "../../src/server/bootstrap/bootstrap-admin-cli";
import { legacySchoolCode, legacySchoolId } from "../../src/domain/school/legacy-school";
import type { CommandContext } from "../../src/server/commands/command-context";
import { decideActionIntent } from "../../src/server/commands/decide-action-intent";
import { saveActivityDraft } from "../../src/server/commands/save-activity-draft";
import { saveReleaseGroup } from "../../src/server/commands/manage-release-group";
import { saveSubmissionWorkingCopy } from "../../src/server/commands/save-submission-working-copy";
import { startSubmissionResubmission } from "../../src/server/commands/start-submission-resubmission";
import { submitSubmissionRevision } from "../../src/server/commands/submit-submission-revision";
import { prepareTeacherFeedbackIntent } from "../../src/server/commands/prepare-teacher-feedback-intent";
import { saveTeacherFeedback } from "../../src/server/commands/save-teacher-feedback";
import { prepareTeacherEvaluationIntent } from "../../src/server/commands/prepare-teacher-evaluation-intent";
import { saveTeacherEvaluation } from "../../src/server/commands/save-teacher-evaluation";
import {
  closePublishedActivity,
  createPublishedActivity,
} from "../../src/test/fixtures/published-activity";

nextEnvironment.loadEnvConfig(process.cwd());

const COMPLETE_TITLE = "校园节水行动";
const LIVE_TITLE = "校园用水现场调查";
const CLOSED_TITLE = "节水倡议展示";
const EDITING_TITLE = "饮水区用水记录";
const READY_TITLE = "教室采光改造提案";
const DEMO_TITLES = [
  COMPLETE_TITLE,
  LIVE_TITLE,
  CLOSED_TITLE,
  EDITING_TITLE,
  READY_TITLE,
] as const;
const LEGACY_DEMO_PREFIX = "【演示】";

const DEMO_CLASSROOM_ID = "7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e01";
const DEMO_CLASSROOM_NAME = "七年一班";
const DEMO_TEACHER_NAME = "林老师";
const DEMO_LOGIN_STUDENT_NAME = "陈同学";

const extraStudents = [
  {
    studentNo: "700002",
    displayName: "李明",
    rosterKey: "DEMOSTU02",
  },
  {
    studentNo: "700003",
    displayName: "王芳",
    rosterKey: "DEMOSTU03",
  },
  {
    studentNo: "700004",
    displayName: "赵强",
    rosterKey: "DEMOSTU04",
  },
] as const;

const DEMO_TEACHER_STAFF_NO = "T-DEMO";
const DEMO_LOGIN_STUDENT_NO = "700001";

function processOnlyPassword(name: string): string {
  return process.env[name]?.trim() || randomBytes(32).toString("base64url");
}

function context(actorId: string, now: Date): CommandContext {
  return {
    actorId,
    source: "UI",
    traceId: `demo-seed-${randomUUID()}`,
    clock: () => now,
  };
}

function parseSeedArgs(argv: readonly string[]): {
  confirmedDatabase: string;
  reset: boolean;
} {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  const index = args.indexOf("--confirm-database");
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) {
    throw new Error("CONFIRM_DATABASE_REQUIRED");
  }
  return {
    confirmedDatabase: value,
    reset: args.includes("--reset"),
  };
}

/**
 * The demo task books live in `src/fixtures/demo-activities.ts`, one design per
 * activity rather than one design retitled five times. Submission mode is part
 * of each design, not a seeding argument: a one-shot showcase and a three-phase
 * investigation are different activities, not the same activity configured
 * differently.
 */
function taskBook(title: string): ActivityContentV3 {
  const found = demoActivitiesV3.find((activity) => activity.title === title);
  if (!found) {
    throw new Error(`DEMO_TASK_BOOK_MISSING:${title}`);
  }
  return found;
}

function covering(
  title: string,
  levels: Array<"excellent" | "good" | "pass" | "improve" | "insufficient">,
): TeacherEvaluationOutcome[] {
  // Outcomes are bound to the published snapshot's own rubric, so a demo
  // evaluation cannot drift from the task book it is evaluating.
  return taskBook(title).rubricDimensions.map((dimension, index) => {
    const level = levels[index] ?? "pass";
    if (level === "insufficient") {
      return {
        dimensionIndex: index + 1,
        dimensionName: dimension.name,
        status: "INSUFFICIENT_EVIDENCE" as const,
        citations: [],
      };
    }
    return {
      dimensionIndex: index + 1,
      dimensionName: dimension.name,
      status: "LEVEL" as const,
      level,
      citations: [{ kind: "text" as const }],
    };
  });
}

class Clock {
  now(): Date {
    return new Date();
  }

  tick(): Date {
    return this.now();
  }
}

async function findLocalIdentityId(
  database: PrismaClient,
  identifier: string,
): Promise<string> {
  const credential = await database.localCredential.findUnique({
    where: { identifier },
    select: { user: { select: { id: true, schoolId: true } } },
  });
  if (!credential || credential.user.schoolId !== legacySchoolId) {
    throw new Error("DEMO_LOCAL_IDENTITY_NOT_FOUND");
  }
  return credential.user.id;
}

async function setStudentRosterKeys(
  database: PrismaClient,
  students: readonly { identifier: string; rosterKey: string }[],
): Promise<void> {
  await database.$transaction(async (transaction) => {
    for (const student of students) {
      const credential = await transaction.localCredential.findUnique({
        where: { identifier: student.identifier },
        select: {
          user: { select: { id: true, role: true, schoolId: true, rosterKey: true } },
        },
      });
      if (
        !credential ||
        credential.user.role !== "STUDENT" ||
        credential.user.schoolId !== legacySchoolId
      ) {
        throw new Error("DEMO_STUDENT_PROFILE_CONFLICT");
      }
      if (credential.user.rosterKey && credential.user.rosterKey !== student.rosterKey) {
        throw new Error("DEMO_STUDENT_ROSTER_KEY_CONFLICT");
      }
      if (!credential.user.rosterKey) {
        await transaction.appUser.update({
          where: { id: credential.user.id },
          data: { rosterKey: student.rosterKey },
        });
      }
    }
  });
}

async function ensureMembership(
  database: PrismaClient,
  classroomId: string,
  studentId: string,
  joinedAt: Date,
): Promise<void> {
  const current = await database.classroomMembership.findFirst({
    where: { classroomId, studentId, endedAt: null },
    select: { id: true, joinedAt: true },
  });
  if (current) {
    return;
  }
  await database.classroomMembership.create({
    data: { classroomId, studentId, joinedAt },
  });
}

async function findDraftRelease(
  database: PrismaClient,
  ownerId: string,
  title: string,
) {
  return database.activityDraft.findFirst({
    where: { ownerId, title },
    select: {
      id: true,
      version: true,
      status: true,
      release: {
        select: {
          id: true,
          _count: { select: { submissions: true } },
        },
      },
    },
  });
}

async function demoContentIsStale(
  database: PrismaClient,
  releaseId: string | undefined,
): Promise<boolean> {
  if (!releaseId) {
    return false;
  }
  const snapshot = await database.activityReleaseSnapshot.findUnique({
    where: { releaseId },
    select: { content: true },
  });
  // Anything published before the v3 demo task books is stale by definition:
  // the seeded instance exists to show what v3 states, and a v2 snapshot
  // cannot show it.
  const content = snapshot?.content as { schemaVersion?: number } | null;
  if (content?.schemaVersion !== 3) {
    return true;
  }
  const oldRevision = await database.submissionRevision.findFirst({
    where: {
      submission: { releaseId },
      OR: [
        { textEvidence: { contains: "课间在教学楼" } },
        { textEvidence: { contains: "现场演示用" } },
      ],
    },
    select: { id: true },
  });
  return Boolean(oldRevision);
}

async function resetDemoActivities(
  database: PrismaClient,
  ownerId: string,
): Promise<number> {
  const drafts = await database.activityDraft.findMany({
    where: {
      ownerId,
      OR: [
        { title: { in: [...DEMO_TITLES] } },
        { title: { startsWith: LEGACY_DEMO_PREFIX } },
      ],
    },
    select: {
      id: true,
      release: {
        select: {
          id: true,
          actionIntentId: true,
          closeActionIntentId: true,
        },
      },
    },
  });
  if (drafts.length === 0) {
    return 0;
  }

  await database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('session_replication_role', 'replica', true)`;
    const draftIds = drafts.map((draft) => draft.id);
    const releases = drafts.flatMap((draft) =>
      draft.release ? [draft.release] : [],
    );
    const releaseIds = releases.map((release) => release.id);
    const publishIntentIds = releases.flatMap((release) => [
      release.actionIntentId,
      ...(release.closeActionIntentId ? [release.closeActionIntentId] : []),
    ]);

    const submissions =
      releaseIds.length === 0
        ? []
        : await tx.submission.findMany({
            where: { releaseId: { in: releaseIds } },
            select: { id: true },
          });
    const submissionIds = submissions.map((row) => row.id);
    const revisions =
      submissionIds.length === 0
        ? []
        : await tx.submissionRevision.findMany({
            where: { submissionId: { in: submissionIds } },
            select: { id: true },
          });
    const revisionIds = revisions.map((row) => row.id);

    const feedbacks =
      revisionIds.length === 0
        ? []
        : await tx.teacherFeedback.findMany({
            where: { submissionRevisionId: { in: revisionIds } },
            select: { id: true },
          });
    const feedbackIds = feedbacks.map((row) => row.id);
    const feedbackRevisions =
      feedbackIds.length === 0
        ? []
        : await tx.teacherFeedbackRevision.findMany({
            where: { teacherFeedbackId: { in: feedbackIds } },
            select: { actionIntentId: true },
          });

    const evaluations =
      revisionIds.length === 0
        ? []
        : await tx.teacherEvaluation.findMany({
            where: { submissionRevisionId: { in: revisionIds } },
            select: { id: true },
          });
    const evaluationIds = evaluations.map((row) => row.id);
    const evaluationRevisions =
      evaluationIds.length === 0
        ? []
        : await tx.teacherEvaluationRevision.findMany({
            where: { teacherEvaluationId: { in: evaluationIds } },
            select: { actionIntentId: true },
          });

    const intentIds = [
      ...publishIntentIds,
      ...feedbackRevisions.map((row) => row.actionIntentId),
      ...evaluationRevisions.map((row) => row.actionIntentId),
    ];
    const resourceIds = [...draftIds, ...releaseIds, ...submissionIds];

    if (feedbackIds.length > 0) {
      await tx.teacherFeedbackRevision.deleteMany({
        where: { teacherFeedbackId: { in: feedbackIds } },
      });
      await tx.teacherFeedback.deleteMany({
        where: { id: { in: feedbackIds } },
      });
    }
    if (evaluationIds.length > 0) {
      await tx.teacherEvaluationRevision.deleteMany({
        where: { teacherEvaluationId: { in: evaluationIds } },
      });
      await tx.teacherEvaluation.deleteMany({
        where: { id: { in: evaluationIds } },
      });
    }
    if (revisionIds.length > 0) {
      await tx.submissionRevisionAttachment.deleteMany({
        where: { submissionRevisionId: { in: revisionIds } },
      });
      await tx.submissionRevision.deleteMany({
        where: { id: { in: revisionIds } },
      });
    }
    if (submissionIds.length > 0) {
      const workingCopies = await tx.submissionWorkingCopy.findMany({
        where: { submissionId: { in: submissionIds } },
        select: { id: true },
      });
      const workingCopyIds = workingCopies.map((row) => row.id);
      if (workingCopyIds.length > 0) {
        await tx.submissionWorkingCopyAttachment.deleteMany({
          where: { workingCopyId: { in: workingCopyIds } },
        });
        await tx.submissionWorkingCopy.deleteMany({
          where: { id: { in: workingCopyIds } },
        });
      }
      await tx.submissionAttachment.deleteMany({
        where: { submissionId: { in: submissionIds } },
      });
      await tx.submission.deleteMany({
        where: { id: { in: submissionIds } },
      });
    }
    if (releaseIds.length > 0) {
      const groups = await tx.releaseGroup.findMany({
        where: { releaseId: { in: releaseIds } },
        select: { id: true },
      });
      const groupIds = groups.map((row) => row.id);
      if (groupIds.length > 0) {
        await tx.releaseGroupMember.deleteMany({
          where: { groupId: { in: groupIds } },
        });
        await tx.releaseGroup.deleteMany({
          where: { id: { in: groupIds } },
        });
      }
      await tx.activityReleaseSnapshot.deleteMany({
        where: { releaseId: { in: releaseIds } },
      });
      await tx.activityRelease.deleteMany({
        where: { id: { in: releaseIds } },
      });
    }
    await tx.activityDraftRevision.deleteMany({
      where: { draftId: { in: draftIds } },
    });
    await tx.activityDraft.deleteMany({
      where: { id: { in: draftIds } },
    });
    if (resourceIds.length > 0) {
      await tx.idempotencyRecord.deleteMany({
        where: { resourceId: { in: resourceIds } },
      });
      await tx.actionAudit.deleteMany({
        where: { targetId: { in: resourceIds } },
      });
      await tx.actionIntent.deleteMany({
        where: { targetId: { in: resourceIds } },
      });
    }
    if (intentIds.length > 0) {
      await tx.actionAudit.deleteMany({
        where: { actionIntentId: { in: intentIds } },
      });
      await tx.actionIntent.deleteMany({
        where: { id: { in: intentIds } },
      });
    }
  });

  return drafts.length;
}

async function alignDraftWallClock(
  database: PrismaClient,
  draftId: string,
): Promise<void> {
  await database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT set_config('session_replication_role', 'replica', true)`;
    const now = new Date();
    await transaction.activityDraft.update({
      where: { id: draftId },
      data: { createdAt: now, updatedAt: now },
    });
  });
}

async function publishDemoActivity(
  database: PrismaClient,
  input: {
    teacherId: string;
    classroomId: string;
    title: string;
    existing: Awaited<ReturnType<typeof findDraftRelease>>;
    clock: Clock;
  },
) {
  if (input.existing?.release) {
    return { releaseId: input.existing.release.id };
  }
  const draft =
    input.existing?.status === "READY_FOR_PREVIEW"
      ? { draftId: input.existing.id, version: input.existing.version }
      : undefined;
  if (draft) {
    await alignDraftWallClock(database, draft.draftId);
  }
  return createPublishedActivity(database, {
    teacherId: input.teacherId,
    classroomId: input.classroomId,
    publishedAt: input.clock.tick(),
    content: taskBook(input.title),
    draft,
  });
}

async function submitPhase(
  database: PrismaClient,
  studentId: string,
  releaseId: string,
  phaseIndex: number,
  textEvidence: string,
  clock: Clock,
) {
  const existing = await database.submission.findUnique({
    where: {
      releaseId_studentId_phaseIndex: { releaseId, studentId, phaseIndex },
    },
    include: { workingCopy: true },
  });
  const saved = await saveSubmissionWorkingCopy(
    database,
    context(studentId, clock.tick()),
    {
      releaseId,
      phaseIndex,
      expectedWorkingCopyId: existing?.workingCopy?.id ?? null,
      expectedWorkingVersion: existing?.workingCopy?.version ?? null,
      textEvidence,
      completedEvidenceIndexes: phaseIndex === 0 ? [] : [1],
      idempotencyKey: `demo_save_${studentId}_${phaseIndex}_${randomUUID()}`,
    },
  );
  return submitSubmissionRevision(
    database,
    context(studentId, clock.tick()),
    {
      releaseId,
      phaseIndex,
      expectedWorkingCopyId: saved.workingCopyId,
      expectedWorkingVersion: saved.workingVersion,
      idempotencyKey: `demo_submit_${studentId}_${phaseIndex}_${randomUUID()}`,
    },
  );
}

async function giveFeedback(
  database: PrismaClient,
  teacherId: string,
  submission: { submissionId: string; revisionId: string; revisionNumber: number },
  body: string,
  nextStep: "CONTINUE" | "REVISE",
  supportLevel: "FOUNDATION" | "STANDARD" | "CHALLENGE",
  clock: Clock,
) {
  const prepared = await prepareTeacherFeedbackIntent(
    database,
    context(teacherId, clock.tick()),
    {
      submissionId: submission.submissionId,
      expectedSubmissionRevisionId: submission.revisionId,
      expectedSubmissionRevisionNumber: submission.revisionNumber,
      expectedFeedbackVersion: 0,
      body,
      nextStep,
      supportLevel,
      suggestionAgentRunId: null,
      idempotencyKey: `demo_prepare_feedback_${randomUUID()}`,
    },
  );
  await decideActionIntent(database, context(teacherId, clock.tick()), {
    actionIntentId: prepared.actionIntentId,
    decision: "CONFIRM",
  });
  return saveTeacherFeedback(database, context(teacherId, clock.tick()), {
    actionIntentId: prepared.actionIntentId,
    idempotencyKey: `demo_save_feedback_${randomUUID()}`,
  });
}

async function giveEvaluation(
  database: PrismaClient,
  teacherId: string,
  submission: { submissionId: string; revisionId: string; revisionNumber: number },
  summary: string,
  outcomes: TeacherEvaluationOutcome[],
  clock: Clock,
) {
  const prepared = await prepareTeacherEvaluationIntent(
    database,
    context(teacherId, clock.tick()),
    {
      submissionId: submission.submissionId,
      expectedSubmissionRevisionId: submission.revisionId,
      expectedSubmissionRevisionNumber: submission.revisionNumber,
      expectedEvaluationVersion: 0,
      summary,
      outcomes,
      suggestionAgentRunId: null,
      idempotencyKey: `demo_prepare_eval_${randomUUID()}`,
    },
  );
  await decideActionIntent(database, context(teacherId, clock.tick()), {
    actionIntentId: prepared.actionIntentId,
    decision: "CONFIRM",
  });
  return saveTeacherEvaluation(database, context(teacherId, clock.tick()), {
    actionIntentId: prepared.actionIntentId,
    idempotencyKey: `demo_save_eval_${randomUUID()}`,
  });
}

async function main(): Promise<void> {
  const { confirmedDatabase, reset } = parseSeedArgs(process.argv.slice(2));
  const target = resolveBootstrapDatabaseTarget(
    {
      databaseUrl: process.env.DATABASE_URL,
      testDatabaseUrl: process.env.TEST_DATABASE_URL,
    },
    confirmedDatabase,
  );
  const database = createDatabaseClient(target.connectionString);
  const clock = new Clock();

  try {
    const loginStudentIdentifier = stagingLocalIdentifier({
      schoolCode: legacySchoolCode,
      role: "STUDENT",
      studentNo: DEMO_LOGIN_STUDENT_NO,
    });
    const extraStudentIdentities = extraStudents.map((student, index) => ({
      ...student,
      identifier: stagingLocalIdentifier({
        schoolCode: legacySchoolCode,
        role: "STUDENT",
        studentNo: student.studentNo,
      }),
      password: processOnlyPassword(`DEV_TEST_DEMO_STUDENT_${index + 2}_PASSWORD`),
    }));
    await bootstrapLocalStaging(database, {
      schools: [
        { code: legacySchoolCode, name: "历史迁移学校", status: "ACTIVE" },
      ],
      identities: [
        {
          schoolCode: legacySchoolCode,
          identifier: stagingLocalIdentifier({
            schoolCode: legacySchoolCode,
            role: "TEACHER",
            staffNo: DEMO_TEACHER_STAFF_NO,
          }),
          password: processOnlyPassword("DEV_TEST_DEMO_TEACHER_PASSWORD"),
          displayName: DEMO_TEACHER_NAME,
          role: "TEACHER",
          staffNo: DEMO_TEACHER_STAFF_NO,
        },
        {
          schoolCode: legacySchoolCode,
          identifier: loginStudentIdentifier,
          password: processOnlyPassword("DEV_TEST_DEMO_STUDENT_1_PASSWORD"),
          displayName: DEMO_LOGIN_STUDENT_NAME,
          role: "STUDENT",
          studentNo: DEMO_LOGIN_STUDENT_NO,
        },
        ...extraStudentIdentities.map((student) => ({
          schoolCode: legacySchoolCode,
          identifier: student.identifier,
          password: student.password,
          displayName: student.displayName,
          role: "STUDENT" as const,
          studentNo: student.studentNo,
        })),
      ],
      classroom: {
        id: DEMO_CLASSROOM_ID,
        name: DEMO_CLASSROOM_NAME,
        teacherIdentifier: stagingLocalIdentifier({
          schoolCode: legacySchoolCode,
          role: "TEACHER",
          staffNo: DEMO_TEACHER_STAFF_NO,
        }),
        studentIdentifiers: [
          loginStudentIdentifier,
          ...extraStudentIdentities.map((student) => student.identifier),
        ],
      },
    });
    const teacherIdentifier = stagingLocalIdentifier({
      schoolCode: legacySchoolCode,
      role: "TEACHER",
      staffNo: DEMO_TEACHER_STAFF_NO,
    });
    const teacherId = await findLocalIdentityId(database, teacherIdentifier);
    const loginStudentId = await findLocalIdentityId(
      database,
      loginStudentIdentifier,
    );
    const extraStudentIds = await Promise.all(
      extraStudentIdentities.map((student) =>
        findLocalIdentityId(database, student.identifier),
      ),
    );
    const [liMingId, wangFangId, zhaoQiangId] = extraStudentIds;
    await setStudentRosterKeys(database, [
      { identifier: loginStudentIdentifier, rosterKey: "DEMOSTU01" },
      ...extraStudentIdentities.map((student) => ({
        identifier: student.identifier,
        rosterKey: student.rosterKey,
      })),
    ]);
    const teacher = await database.appUser.findUniqueOrThrow({
      where: { id: teacherId },
      select: { id: true, displayName: true, role: true },
    });
    const loginStudent = await database.appUser.findUniqueOrThrow({
      where: { id: loginStudentId },
      select: { id: true, displayName: true, role: true },
    });
    const classroom = {
      id: DEMO_CLASSROOM_ID,
      name: DEMO_CLASSROOM_NAME,
    };

    let existingComplete = await findDraftRelease(
      database,
      teacher.id,
      COMPLETE_TITLE,
    );
    const stale = await demoContentIsStale(
      database,
      existingComplete?.release?.id,
    );
    const leftoverPrefixed = await database.activityDraft.findFirst({
      where: {
        ownerId: teacher.id,
        title: { startsWith: LEGACY_DEMO_PREFIX },
      },
      select: { id: true },
    });
    if (reset || stale || leftoverPrefixed) {
      await resetDemoActivities(database, teacher.id);
      existingComplete = await findDraftRelease(
        database,
        teacher.id,
        COMPLETE_TITLE,
      );
    }
    const existingLive = await findDraftRelease(database, teacher.id, LIVE_TITLE);
    const existingClosed = await findDraftRelease(
      database,
      teacher.id,
      CLOSED_TITLE,
    );
    if (
      (existingComplete?.release?._count.submissions ?? 0) > 0 &&
      existingLive?.release &&
      existingClosed?.release
    ) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            skipped: true,
            reason: "DEMO_ALREADY_SEEDED",
            databaseTarget: target.redactedTarget,
            login: {
              teacher: teacher.displayName,
              student: loginStudent.displayName,
              classroom: classroom.name,
            },
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const membershipJoinedAt = clock.now();
    for (const studentId of [
      loginStudent.id,
      ...extraStudentIds,
    ]) {
      await ensureMembership(
        database,
        classroom.id,
        studentId,
        membershipJoinedAt,
      );
    }

    if (!(await findDraftRelease(database, teacher.id, EDITING_TITLE))) {
      await saveActivityDraft(database, context(teacher.id, clock.tick()), {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "EDITING",
        content: taskBook(EDITING_TITLE),
        agentRunId: null,
        idempotencyKey: `demo_draft_editing_${randomUUID()}`,
      });
    }
    if (!(await findDraftRelease(database, teacher.id, READY_TITLE))) {
      await saveActivityDraft(database, context(teacher.id, clock.tick()), {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "READY_FOR_PREVIEW",
        content: taskBook(READY_TITLE),
        agentRunId: null,
        idempotencyKey: `demo_draft_ready_${randomUUID()}`,
      });
    }

    const complete = existingComplete?.release
      ? { releaseId: existingComplete.release.id }
      : await createPublishedActivity(database, {
          teacherId: teacher.id,
          classroomId: classroom.id,
          publishedAt: clock.tick(),
          content: taskBook(COMPLETE_TITLE),
        });

    if ((existingComplete?.release?._count.submissions ?? 0) === 0) {

    const chenP1 = await submitPhase(
      database,
      loginStudent.id,
      complete.releaseId,
      1,
      "总务处让我们先去现场看。课间 08:05–08:20，我在教学楼一层洗手间守了 15 分钟：11 人洗手后没关紧水龙头，水槽一直滴。这里最像每天都在漏水。",
      clock,
    );
    await giveFeedback(
      database,
      teacher.id,
      chenP1,
      "观察员已经把地点和时间钉住了。下一阶段请用可比较的数据说明这是偶发还是反复发生，别只停在现象。",
      "CONTINUE",
      "STANDARD",
      clock,
    );
    await giveEvaluation(
      database,
      teacher.id,
      chenP1,
      "问题来自真实洗手间场景。现在的记录还不够支撑总务处做决定。",
      covering(COMPLETE_TITLE, ["good", "pass", "good", "pass"]),
      clock,
    );

    const chenP2v1 = await submitPhase(
      database,
      loginStudent.id,
      complete.releaseId,
      2,
      "目前只有上午这一组观察，还不能告诉总务处是不是全天都在浪费水。",
      clock,
    );
    await giveFeedback(
      database,
      teacher.id,
      chenP2v1,
      "证据偏少。请补一组下午观察，或加简单问卷，再用来说服总务处。",
      "REVISE",
      "FOUNDATION",
      clock,
    );
    await giveEvaluation(
      database,
      teacher.id,
      chenP2v1,
      "问题清楚，但还说服不了总务处。",
      covering(COMPLETE_TITLE, ["good", "improve", "pass", "improve"]),
      clock,
    );
    const resubmit = await startSubmissionResubmission(
      database,
      context(loginStudent.id, clock.tick()),
      {
        releaseId: complete.releaseId,
        phaseIndex: 2,
        expectedLatestRevisionNumber: chenP2v1.revisionNumber,
        idempotencyKey: `demo_resubmit_${randomUUID()}`,
      },
    );
    const savedP2 = await saveSubmissionWorkingCopy(
      database,
      context(loginStudent.id, clock.tick()),
      {
        releaseId: complete.releaseId,
        phaseIndex: 2,
        expectedWorkingCopyId: resubmit.workingCopyId,
        expectedWorkingVersion: resubmit.workingVersion,
        textEvidence:
          "补做下午 16:00–16:20：同一水槽又滴了 7 次；问卷 18 人里 12 人说偶尔不关紧。两组数据都指向洗手后未关紧，不是偶发。",
        completedEvidenceIndexes: [1],
        idempotencyKey: `demo_resave_p2_${randomUUID()}`,
      },
    );
    const chenP2v2 = await submitSubmissionRevision(
      database,
      context(loginStudent.id, clock.tick()),
      {
        releaseId: complete.releaseId,
        phaseIndex: 2,
        expectedWorkingCopyId: savedP2.workingCopyId,
        expectedWorkingVersion: savedP2.workingVersion,
        idempotencyKey: `demo_resubmit_p2_${randomUUID()}`,
      },
    );
    await giveFeedback(
      database,
      teacher.id,
      chenP2v2,
      "下午数据和问卷已经能支撑判断。可以把建议写给总务处了。",
      "CONTINUE",
      "STANDARD",
      clock,
    );
    await giveEvaluation(
      database,
      teacher.id,
      chenP2v2,
      "重交后证据明显增强。跨学科连接还可以写得更清楚，方便公示。",
      covering(COMPLETE_TITLE, ["good", "good", "pass", "good"]),
      clock,
    );

    const chenP3 = await submitPhase(
      database,
      loginStudent.id,
      complete.releaseId,
      3,
      "建议总务处在洗手池加装感应阀；班会用观察表把“关紧水龙头”的动作讲给同学。两条都对着同一组现场证据。",
      clock,
    );
    await giveFeedback(
      database,
      teacher.id,
      chenP3,
      "对象已经是总务处。可再补一条给低年级的提示方式，公示栏会更好用。",
      "CONTINUE",
      "CHALLENGE",
      clock,
    );
    await giveEvaluation(
      database,
      teacher.id,
      chenP3,
      "建议具体可执行，能贴到公示栏。",
      covering(COMPLETE_TITLE, ["excellent", "good", "good", "excellent"]),
      clock,
    );

    const liP1 = await submitPhase(
      database,
      liMingId,
      complete.releaseId,
      1,
      "我选了绿化浇灌区。星期二早晨喷灌喷到路面，积水很明显，像每天都在浪费。",
      clock,
    );
    await giveFeedback(
      database,
      teacher.id,
      liP1,
      "场景清楚。下一阶段用时长和说明书对比，给总务处看。",
      "CONTINUE",
      "STANDARD",
      clock,
    );
    await giveEvaluation(
      database,
      teacher.id,
      liP1,
      "问题钉在浇灌区，证据还可以更量化。",
      covering(COMPLETE_TITLE, ["excellent", "good", "good", "good"]),
      clock,
    );
    const liP2 = await submitPhase(
      database,
      liMingId,
      complete.releaseId,
      2,
      "记录喷灌 12 分钟，路面积水大约 3 米。说明书建议 8 分钟，多出来的时间都喷到了路面。",
      clock,
    );
    await giveFeedback(
      database,
      teacher.id,
      liP2,
      "数据已经能说明问题，可以把建议写给物业和总务处了。",
      "CONTINUE",
      "STANDARD",
      clock,
    );
    await giveEvaluation(
      database,
      teacher.id,
      liP2,
      "证据充分，总务处能看懂浪费发生在超时喷灌。",
      covering(COMPLETE_TITLE, ["excellent", "excellent", "good", "good"]),
      clock,
    );
    const liP3 = await submitPhase(
      database,
      liMingId,
      complete.releaseId,
      3,
      "建议物业按说明书改成 8 分钟喷灌，雨后停灌一天。这两条都对着超时喷到路面的证据。",
      clock,
    );
    await giveFeedback(
      database,
      teacher.id,
      liP3,
      "建议可行。请把对象和执行步骤再写具体一些后重交，公示时才知道谁来改。",
      "REVISE",
      "STANDARD",
      clock,
    );

    const wangP1 = await submitPhase(
      database,
      wangFangId,
      complete.releaseId,
      1,
      "饮水机接水区地面经常湿。我还没统计人数，暂时不能断定是哪一种浪费。",
      clock,
    );
    await giveFeedback(
      database,
      teacher.id,
      wangP1,
      "方向对。请补观察记录后再用数据说明，总务处现在还看不出规模。",
      "CONTINUE",
      "FOUNDATION",
      clock,
    );
    await giveEvaluation(
      database,
      teacher.id,
      wangP1,
      "问题与饮水区有关，证据还不足。",
      covering(COMPLETE_TITLE, ["pass", "improve", "pass", "improve"]),
      clock,
    );
    const wangPhase2 = await database.submission.findUnique({
      where: {
        releaseId_studentId_phaseIndex: {
          releaseId: complete.releaseId,
          studentId: wangFangId,
          phaseIndex: 2,
        },
      },
      include: { workingCopy: true },
    });
    await saveSubmissionWorkingCopy(
      database,
      context(wangFangId, clock.tick()),
      {
        releaseId: complete.releaseId,
        phaseIndex: 2,
        expectedWorkingCopyId: wangPhase2?.workingCopy?.id ?? null,
        expectedWorkingVersion: wangPhase2?.workingCopy?.version ?? null,
        textEvidence: "正在整理问卷：接水区地面湿，还没写完人数和时段。",
        completedEvidenceIndexes: [],
        idempotencyKey: `demo_wang_p2_draft_${randomUUID()}`,
      },
    );
    }

    const live = await publishDemoActivity(database, {
      teacherId: teacher.id,
      classroomId: classroom.id,
      title: LIVE_TITLE,
      existing: existingLive,
      clock,
    });
    if (!existingLive?.release) {
    await saveReleaseGroup(database, context(teacher.id, clock.tick()), {
      releaseId: live.releaseId,
      groupId: null,
      name: "节水观察组",
      members: [
        { studentId: wangFangId, roleLabel: "记录" },
        { studentId: zhaoQiangId, roleLabel: "汇报" },
      ],
      idempotencyKey: `demo_group_${randomUUID()}`,
    });
    await submitPhase(
      database,
      loginStudent.id,
      live.releaseId,
      1,
      "总务处请我们先看现场。我在一层洗手间记下了时间和滴水现象，等老师看过再决定要不要继续测。",
      clock,
    );
    const liLive = await submitPhase(
      database,
      liMingId,
      live.releaseId,
      1,
      "浇灌区早晨喷到路面，我已经把时间和地点交上去了。",
      clock,
    );
    await giveFeedback(
      database,
      teacher.id,
      liLive,
      "场景清楚，可以进入用数据说明的阶段。",
      "CONTINUE",
      "STANDARD",
      clock,
    );
    }

    const closed = await publishDemoActivity(database, {
      teacherId: teacher.id,
      classroomId: classroom.id,
      title: CLOSED_TITLE,
      existing: existingClosed,
      clock,
    });
    if (!existingClosed?.release) {
    const closedSubmission = await submitPhase(
      database,
      loginStudent.id,
      closed.releaseId,
      0,
      "洗手区已经张贴“用完拧紧”示意图，并附上观察记录，给总务处做公示。",
      clock,
    );
    await giveFeedback(
      database,
      teacher.id,
      closedSubmission,
      "倡议清楚。这次展示已经结束，评价只供查看。",
      "CONTINUE",
      "STANDARD",
      clock,
    );
    await giveEvaluation(
      database,
      teacher.id,
      closedSubmission,
      "整项成果达到合格以上。",
      covering(CLOSED_TITLE, ["good", "pass", "good", "pass"]),
      clock,
    );
    await closePublishedActivity(database, {
      teacherId: teacher.id,
      releaseId: closed.releaseId,
      closedAt: clock.tick(),
    });
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          skipped: false,
          databaseTarget: target.redactedTarget,
          classroom: classroom.name,
          login: {
            teacher: teacher.displayName,
            student: loginStudent.displayName,
            extraStudents: extraStudents.map((student) => student.displayName),
            note: "李明、王芳、赵强用于演示花名册，登录凭据只存在于进程内。",
          },
          seeded: {
            drafts: [EDITING_TITLE, READY_TITLE],
            releases: [COMPLETE_TITLE, LIVE_TITLE, CLOSED_TITLE],
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${serializeBootstrapAdminCliError(error)}\n`);
  if (error instanceof Error && error.message === "CONFIRM_DATABASE_REQUIRED") {
    process.stderr.write(
      "Usage: pnpm demo:seed -- --confirm-database <database-name> [--reset]\n",
    );
  }
  if (error instanceof Error && !error.message.startsWith("{")) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
  }
  process.exitCode = 1;
});
