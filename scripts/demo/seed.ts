import { randomUUID } from "node:crypto";
import { rm, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import nextEnvironment from "@next/env";
import canonicalize from "canonicalize";
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import {
  activityContentV3Schema,
  type ActivityContentV3,
} from "../../src/domain/activity/activity-content";
import { demoActivitiesV3 } from "../../src/fixtures/demo-activities";
import type { TeacherEvaluationOutcome } from "../../src/domain/evaluation/teacher-evaluation-intent";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { createDatabaseClient } from "../../src/server/db/client";
import {
  bootstrapLocalStaging,
  stagingLocalIdentifier,
} from "../../src/server/bootstrap/bootstrap-local-staging";
import { bootstrapPlatformAdmin } from "../../src/server/bootstrap/bootstrap-admin";
import {
  resolveBootstrapDatabaseTarget,
  serializeBootstrapAdminCliError,
} from "../../src/server/bootstrap/bootstrap-admin-cli";
import { legacySchoolCode, legacySchoolId } from "../../src/domain/school/legacy-school";
import { adminIdentifier, hashPassword } from "../../src/server/auth/local-auth-primitives";
import type { CommandContext } from "../../src/server/commands/command-context";
import { decideActionIntent } from "../../src/server/commands/decide-action-intent";
import { saveActivityDraft } from "../../src/server/commands/save-activity-draft";
import { saveReleaseGroup } from "../../src/server/commands/manage-release-group";
import { saveSubmissionWorkingCopy } from "../../src/server/commands/save-submission-working-copy";
import { startSubmissionResubmission } from "../../src/server/commands/start-submission-resubmission";
import { submitSubmissionRevision } from "../../src/server/commands/submit-submission-revision";
import { copyActivityDraft } from "../../src/server/commands/copy-activity-draft";
import { createServerReceivedAttachmentStorage } from "../../src/server/attachments/attachment-storage-factory";
import {
  createSubmissionAttachmentUpload,
  finalizeSubmissionAttachmentUpload,
  refreshSubmissionAttachmentScan,
} from "../../src/server/attachments/submission-attachment-service";
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
const LIVE_TITLE = "校园植物身份证";
const CLOSED_TITLE = "家乡老物件展";
const EDITING_TITLE = "班级图书角借阅改进";
const READY_TITLE = "教室采光改造提案";
const COPY_TITLE = "校园节水行动（七年二班版）";
/**
 * Titles an earlier seed used. A reset removes them too, so a workspace seeded
 * before the themes changed does not keep three stray water activities.
 */
const RETIRED_DEMO_TITLES = ["校园用水现场调查", "节水倡议展示", "饮水区用水记录"] as const;
const DEMO_TITLES = [
  COMPLETE_TITLE,
  LIVE_TITLE,
  CLOSED_TITLE,
  EDITING_TITLE,
  READY_TITLE,
  COPY_TITLE,
  ...RETIRED_DEMO_TITLES,
] as const;
const LEGACY_DEMO_PREFIX = "【演示】";

const DEMO_CLASSROOM_ID = "7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e01";
const DEMO_CLASSROOM_NAME = "七年一班";
const SECOND_CLASSROOM_ID = "7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e02";
const SECOND_CLASSROOM_NAME = "七年二班";
const DEMO_TEACHER_NAME = "林老师";
const DEMO_LOGIN_STUDENT_NAME = "陈同学";
const DEMO_ADMIN_USERNAME = "platformadmin";
const DEMO_ADMIN_NAME = "平台管理员";
const DEMO_ADMIN_PASSWORD = "PlatformAdmin2026";
const DEMO_TEACHER_PASSWORD = "Teacher2026demo";
const DEMO_STUDENT_PASSWORD = "Student2026demo";

/**
 * 七年一班 has twelve students so that every part of the process diagnosis has
 * at least three samples to show (`INSIGHTS_MIN_SAMPLE`, `WEAK_MIN_SAMPLE`,
 * `ANSWER_THEMES_MIN_ANSWERS`). With four, most of the page said 样本不足.
 */
const extraStudents = [
  { key: "li", studentNo: "700002", displayName: "李明", rosterKey: "DEMOSTU02" },
  { key: "wang", studentNo: "700003", displayName: "王芳", rosterKey: "DEMOSTU03" },
  { key: "zhao", studentNo: "700004", displayName: "赵强", rosterKey: "DEMOSTU04" },
  { key: "liu", studentNo: "700005", displayName: "刘洋", rosterKey: "DEMOSTU05" },
  { key: "zhang", studentNo: "700006", displayName: "张悦", rosterKey: "DEMOSTU06" },
  { key: "yang", studentNo: "700007", displayName: "杨帆", rosterKey: "DEMOSTU07" },
  { key: "huang", studentNo: "700008", displayName: "黄子涵", rosterKey: "DEMOSTU08" },
  { key: "zhou", studentNo: "700009", displayName: "周宇航", rosterKey: "DEMOSTU09" },
  { key: "wu", studentNo: "700010", displayName: "吴思琪", rosterKey: "DEMOSTU10" },
  { key: "xu", studentNo: "700011", displayName: "徐晨", rosterKey: "DEMOSTU11" },
  { key: "sun", studentNo: "700012", displayName: "孙浩然", rosterKey: "DEMOSTU12" },
] as const;

/** 七年二班 has no activity yet: it is where a copied or adapted design goes. */
const secondClassStudents = [
  { studentNo: "700101", displayName: "何雨桐", rosterKey: "DEMOSTU21" },
  { studentNo: "700102", displayName: "罗子轩", rosterKey: "DEMOSTU22" },
  { studentNo: "700103", displayName: "郑可欣", rosterKey: "DEMOSTU23" },
  { studentNo: "700104", displayName: "马俊杰", rosterKey: "DEMOSTU24" },
] as const;

type DemoStudentKey = "chen" | (typeof extraStudents)[number]["key"];

const DEMO_TEACHER_STAFF_NO = "T-DEMO";
const DEMO_LOGIN_STUDENT_NO = "700001";

async function ensureDemoAdminCredential(
  database: PrismaClient,
  clock: Clock,
): Promise<void> {
  const identifier = adminIdentifier(DEMO_ADMIN_USERNAME);
  const passwordHash = await hashPassword(DEMO_ADMIN_PASSWORD);
  const result = await bootstrapPlatformAdmin(database, {
    adminIdentifier: identifier,
    passwordHash,
    adminDisplayName: DEMO_ADMIN_NAME,
  }, () => clock.tick());

  // Unlike the operator CLI, the local demo seed is deliberately repeatable:
  // every run restores the documented demo credential and ends old sessions.
  await database.$transaction(async (transaction) => {
    await transaction.localCredential.update({
      where: { identifier },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: clock.tick(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await transaction.authSession.updateMany({
      where: { userId: result.admin.id, revokedAt: null },
      data: { revokedAt: clock.tick() },
    });
  });
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where the demo's events sit in time. Commands run on the wall clock — they
 * stamp rows from the command context and from database defaults alike, and
 * mixing a simulated clock into that would break their ordering checks — so
 * everything is written "now", and the marks record which stretch of the run
 * belongs to which day of the story. `rewrite` then maps every timestamp
 * written during the run onto those days, piecewise linearly. The map only
 * ever moves an instant to its own segment's story span and keeps order, so
 * every "before/after" the commands checked still holds afterwards.
 *
 * Without it every event happened in the same minute: nobody was ever idle
 * for five days (`STALL_DAYS`), and a three-phase activity looked finished in
 * an afternoon.
 */
class Timeline {
  private readonly anchor = new Date();
  private readonly marks: { real: number; target: number }[] = [];

  /** Rows written since the previous mark land between it and `daysAgo`. */
  mark(daysAgo: number): void {
    this.marks.push({ real: Date.now(), target: this.anchor.getTime() - daysAgo * DAY_MS });
  }

  async rewrite(database: PrismaClient, classroomIds: readonly string[]): Promise<void> {
    const segments = this.marks
      .slice(1)
      .map((end, index) => ({ start: this.marks[index]!, end }))
      .filter((segment) => segment.end.real > segment.start.real);
    if (segments.length === 0) return;
    const first = segments[0]!.start;
    const last = segments.at(-1)!.end.real;
    // Session rows belong to whoever is signed in, not to the story.
    const columns = await database.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'timestamp with time zone'
        AND table_name NOT IN ('_prisma_migrations', 'auth_sessions')
      ORDER BY table_name, column_name`;
    const byTable = new Map<string, string[]>();
    for (const { table_name: table, column_name: column } of columns) {
      byTable.set(table, [...(byTable.get(table) ?? []), column]);
    }
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const inWindow = (ref: string) =>
      `${ref} >= to_timestamp(${first.real} / 1000.0) AND ${ref} <= to_timestamp(${last} / 1000.0)`;
    const mapped = (ref: string) => {
      const epoch = `extract(epoch from ${ref}) * 1000`;
      const cases = segments
        .map(({ start, end }) => {
          const scale = (end.target - start.target) / (end.real - start.real);
          return `WHEN ${ref} <= to_timestamp(${end.real} / 1000.0) THEN to_timestamp((${start.target} + (${epoch} - ${start.real}) * ${scale}) / 1000.0)`;
        })
        .join(" ");
      return `CASE WHEN ${inWindow(ref)} THEN CASE ${cases} END ELSE ${ref} END`;
    };
    await database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('session_replication_role', 'replica', true)`;
        // One statement per table, so a row's CHECK constraints (decided
        // before expiry, due after publish…) see all of its columns moved.
        for (const [table, tableColumns] of byTable) {
          const refs = tableColumns.map(quote);
          await tx.$executeRawUnsafe(
            `UPDATE ${quote(table)} SET ${refs.map((ref) => `${ref} = ${mapped(ref)}`).join(", ")}
             WHERE ${refs.map((ref) => `(${inWindow(ref)})`).join(" OR ")}`,
          );
        }
        // A classroom and its members outlive a reset. Where they predate this
        // run they are not moved, so pull them back to the story's start: a
        // submission must not land before its author joined the class.
        const start = new Date(first.target);
        await tx.classroom.updateMany({
          where: { id: { in: [...classroomIds] }, createdAt: { gt: start } },
          data: { createdAt: start },
        });
        await tx.classroomMembership.updateMany({
          where: { classroomId: { in: [...classroomIds] }, endedAt: null, joinedAt: { gt: start } },
          data: { joinedAt: start },
        });
      },
      { timeout: 120_000 },
    );
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

/**
 * Demo data is stale when an earlier version of this script wrote it: other
 * task books, retired titles, or a thinner flagship class. The seed otherwise
 * skips a seeded workspace, so without this check a changed fixture would
 * never reach a database that had been seeded once. Snapshots are compared in
 * canonical form because jsonb does not keep key order.
 */
async function demoContentIsStale(
  database: PrismaClient,
  ownerId: string,
): Promise<boolean> {
  const retired = await database.activityDraft.findFirst({
    where: { ownerId, title: { in: [...RETIRED_DEMO_TITLES] } },
    select: { id: true },
  });
  if (retired) {
    return true;
  }
  for (const title of [COMPLETE_TITLE, LIVE_TITLE, CLOSED_TITLE]) {
    const existing = await findDraftRelease(database, ownerId, title);
    if (!existing?.release) {
      continue;
    }
    const snapshot = await database.activityReleaseSnapshot.findUnique({
      where: { releaseId: existing.release.id },
      select: { content: true },
    });
    const expected = activityContentV3Schema.parse(taskBook(title));
    if (canonicalize(snapshot?.content) !== canonicalize(expected)) {
      return true;
    }
  }
  const complete = await findDraftRelease(database, ownerId, COMPLETE_TITLE);
  if (complete?.release && complete.release._count.submissions > 0) {
    const submitted = await database.submission.count({
      where: { releaseId: complete.release.id, latestRevisionNumber: { gt: 0 } },
    });
    if (submitted < flagshipSubmittedCount()) {
      return true;
    }
  }
  return false;
}

async function resetDemoActivities(
  database: PrismaClient,
  ownerId: string,
): Promise<number> {
  const storageKeys: string[] = [];
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
      storageKeys.push(
        ...(
          await tx.submissionAttachment.findMany({
            where: { submissionId: { in: submissionIds } },
            select: { storageKey: true },
          })
        ).map((row) => row.storageKey),
      );
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
    // Rows written by the later workspace features: copy origins (D-063),
    // adopted sources (D-067), version checks (D-068) and answer summaries
    // (D-086). Replica mode skips foreign-key checks, so leaving them would
    // strand rows that point at deleted drafts and releases. An origin is
    // removed when either end is demo data, including a copy the teacher
    // made of a demo activity under another title; that copy itself stays.
    const draftRevisionIds = (
      await tx.activityDraftRevision.findMany({
        where: { draftId: { in: draftIds } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await tx.activityDraftOrigin.deleteMany({
      where: {
        OR: [
          { draftId: { in: draftIds } },
          { sourceRevisionId: { in: draftRevisionIds } },
          ...(releaseIds.length > 0 ? [{ sourceReleaseId: { in: releaseIds } }] : []),
        ],
      },
    });
    const references = await tx.activityDraftSourceReference.findMany({
      where: { draftId: { in: draftIds } },
      select: { id: true },
    });
    if (references.length > 0) {
      await tx.activityDraftSourceWithdrawal.deleteMany({
        where: { referenceId: { in: references.map((row) => row.id) } },
      });
      await tx.activityDraftSourceReference.deleteMany({
        where: { id: { in: references.map((row) => row.id) } },
      });
    }
    await tx.activityDraftDiagnosis.deleteMany({
      where: { draftId: { in: draftIds } },
    });
    await tx.activityDraftWorkingCopy.deleteMany({
      where: { draftId: { in: draftIds } },
    });
    if (releaseIds.length > 0) {
      await tx.releaseAnswerSummary.deleteMany({
        where: { releaseId: { in: releaseIds } },
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

  await removeAttachmentFiles(storageKeys);
  return drafts.length;
}

/**
 * The product never deletes an attachment's bytes, so a reset would leave each
 * seeded file behind on disk with nothing pointing at it. Only keys of the
 * shape the reservation command writes are touched.
 */
async function removeAttachmentFiles(storageKeys: readonly string[]): Promise<void> {
  const root = process.env.ATTACHMENT_STORAGE_DIR?.trim();
  if (!root || process.env.ATTACHMENT_STORAGE_ENABLED !== "1") return;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const shape = new RegExp(`^submissions/${uuid}/${uuid}$`);
  for (const key of storageKeys) {
    if (!shape.test(key)) continue;
    const path = join(resolve(root), key);
    await rm(path, { force: true });
    await rm(`${path}.meta.json`, { force: true });
    // Removes the submission folder only once it is empty.
    await rmdir(dirname(path)).catch(() => undefined);
  }
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
    dueAt?: Date;
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
    dueAt: input.dueAt ?? null,
    content: taskBook(input.title),
    draft,
  });
}

type DemoAttachment = Readonly<{
  filename: string;
  title: string;
  paragraphs: readonly string[];
  table?: readonly (readonly string[])[];
}>;

const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function renderDocx(attachment: DemoAttachment): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: attachment.title, bold: true, size: 32 })] }),
    ...attachment.paragraphs.map((text) => new Paragraph({ children: [new TextRun(text)] })),
  ];
  if (attachment.table) {
    children.push(
      new Table({
        rows: attachment.table.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) => new TableCell({ children: [new Paragraph(cell)] }),
              ),
            }),
        ),
      }),
    );
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  return new Uint8Array(buffer);
}

/**
 * Attaches a Word file to the student's working copy through the same path the
 * self-hosted upload uses: reserve, write the bytes, read them back, scan. A
 * workspace without attachment storage still seeds; the text evidence carries
 * the submission on its own.
 */
async function attachDocx(
  database: PrismaClient,
  studentId: string,
  releaseId: string,
  phaseIndex: number,
  workingCopy: { workingCopyId: string; workingVersion: number },
  attachment: DemoAttachment,
  clock: Clock,
): Promise<boolean> {
  const storage = createServerReceivedAttachmentStorage();
  if (!storage) {
    return false;
  }
  const bytes = await renderDocx(attachment);
  const reserved = await createSubmissionAttachmentUpload(
    database,
    context(studentId, clock.tick()),
    {
      releaseId,
      expectedWorkingCopyId: workingCopy.workingCopyId,
      expectedWorkingVersion: workingCopy.workingVersion,
      filename: attachment.filename,
      mediaType: DOCX_MEDIA_TYPE,
      byteSize: bytes.byteLength,
      idempotencyKey: `demo_attach_${studentId}_${phaseIndex}_${randomUUID()}`,
    },
  );
  await storage.putObject(reserved.pathname, bytes, DOCX_MEDIA_TYPE);
  await finalizeSubmissionAttachmentUpload(
    database,
    storage,
    context(studentId, clock.tick()),
    reserved.attachmentId,
  );
  const scanned = await refreshSubmissionAttachmentScan(
    database,
    storage,
    context(studentId, clock.tick()),
    reserved.attachmentId,
  );
  if (scanned.status !== "READY") {
    throw new Error(`DEMO_ATTACHMENT_NOT_READY:${scanned.status}`);
  }
  return true;
}

async function currentWorkingCopy(
  database: PrismaClient,
  submissionId: string,
): Promise<{ workingCopyId: string; workingVersion: number }> {
  const workingCopy = await database.submissionWorkingCopy.findUniqueOrThrow({
    where: { submissionId },
    select: { id: true, version: true },
  });
  return { workingCopyId: workingCopy.id, workingVersion: workingCopy.version };
}

type PhaseWork = Readonly<{
  text: string;
  /** 1-based evidence items the student ticked. Defaults to the first one. */
  evidence?: readonly number[];
  attachment?: DemoAttachment;
}>;

async function submitPhase(
  database: PrismaClient,
  studentId: string,
  releaseId: string,
  phaseIndex: number,
  work: PhaseWork,
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
      textEvidence: work.text,
      completedEvidenceIndexes: [
        ...(work.evidence ?? (phaseIndex === 0 ? [] : [1])),
      ],
      idempotencyKey: `demo_save_${studentId}_${phaseIndex}_${randomUUID()}`,
    },
  );
  let workingCopy = {
    workingCopyId: saved.workingCopyId,
    workingVersion: saved.workingVersion,
  };
  if (
    work.attachment &&
    (await attachDocx(database, studentId, releaseId, phaseIndex, workingCopy, work.attachment, clock))
  ) {
    workingCopy = await currentWorkingCopy(database, saved.submissionId);
  }
  return submitSubmissionRevision(
    database,
    context(studentId, clock.tick()),
    {
      releaseId,
      phaseIndex,
      expectedWorkingCopyId: workingCopy.workingCopyId,
      expectedWorkingVersion: workingCopy.workingVersion,
      idempotencyKey: `demo_submit_${studentId}_${phaseIndex}_${randomUUID()}`,
    },
  );
}

/** "Revise and resubmit": reopen the phase, save the new text, submit again. */
async function resubmitPhase(
  database: PrismaClient,
  studentId: string,
  releaseId: string,
  phaseIndex: number,
  previous: { revisionNumber: number },
  work: PhaseWork,
  clock: Clock,
) {
  const reopened = await startSubmissionResubmission(
    database,
    context(studentId, clock.tick()),
    {
      releaseId,
      phaseIndex,
      expectedLatestRevisionNumber: previous.revisionNumber,
      idempotencyKey: `demo_reopen_${studentId}_${phaseIndex}_${randomUUID()}`,
    },
  );
  const saved = await saveSubmissionWorkingCopy(
    database,
    context(studentId, clock.tick()),
    {
      releaseId,
      phaseIndex,
      expectedWorkingCopyId: reopened.workingCopyId,
      expectedWorkingVersion: reopened.workingVersion,
      textEvidence: work.text,
      completedEvidenceIndexes: [...(work.evidence ?? [1])],
      idempotencyKey: `demo_resave_${studentId}_${phaseIndex}_${randomUUID()}`,
    },
  );
  let workingCopy = {
    workingCopyId: saved.workingCopyId,
    workingVersion: saved.workingVersion,
  };
  if (
    work.attachment &&
    (await attachDocx(database, studentId, releaseId, phaseIndex, workingCopy, work.attachment, clock))
  ) {
    workingCopy = await currentWorkingCopy(database, saved.submissionId);
  }
  return submitSubmissionRevision(
    database,
    context(studentId, clock.tick()),
    {
      releaseId,
      phaseIndex,
      expectedWorkingCopyId: workingCopy.workingCopyId,
      expectedWorkingVersion: workingCopy.workingVersion,
      idempotencyKey: `demo_resubmit_${studentId}_${phaseIndex}_${randomUUID()}`,
    },
  );
}

/** A working copy the student saved but has not submitted. */
async function saveDraftOnly(
  database: PrismaClient,
  studentId: string,
  releaseId: string,
  phaseIndex: number,
  text: string,
  clock: Clock,
) {
  const existing = await database.submission.findUnique({
    where: {
      releaseId_studentId_phaseIndex: { releaseId, studentId, phaseIndex },
    },
    include: { workingCopy: true },
  });
  await saveSubmissionWorkingCopy(database, context(studentId, clock.tick()), {
    releaseId,
    phaseIndex,
    expectedWorkingCopyId: existing?.workingCopy?.id ?? null,
    expectedWorkingVersion: existing?.workingCopy?.version ?? null,
    textEvidence: text,
    completedEvidenceIndexes: [],
    idempotencyKey: `demo_draft_${studentId}_${phaseIndex}_${randomUUID()}`,
  });
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

type Levels = Array<"excellent" | "good" | "pass" | "improve" | "insufficient">;
type FeedbackStep = Readonly<{
  body: string;
  nextStep: "CONTINUE" | "REVISE";
  supportLevel: "FOUNDATION" | "STANDARD" | "CHALLENGE";
}>;
type EvaluationStep = Readonly<{ summary: string; levels: Levels }>;
type PhaseStep = PhaseWork &
  Readonly<{
    feedback?: FeedbackStep;
    evaluation?: EvaluationStep;
    resubmit?: PhaseWork &
      Readonly<{ feedback?: FeedbackStep; evaluation?: EvaluationStep }>;
  }>;
type Journey = Readonly<{
  student: DemoStudentKey;
  /** Phases 1, 2, 3 in order; a phase that is missing was never submitted. */
  phases: readonly PhaseStep[];
  /** Text saved in the next phase without submitting it. */
  unsubmitted?: string;
}>;

const readingsTable: DemoAttachment = {
  filename: "洗手间水表读数表.docx",
  title: "教学楼一层洗手间 · 水表读数与估算",
  paragraphs: [
    "点位：教学楼一层女生洗手间第二个水槽（水龙头关不紧）。",
    "方法：在同一块分水表上抄三次读数，每次间隔里不安排同学去用这个水槽，只看它自己滴走多少。",
  ],
  table: [
    ["时间", "读数（立方米）", "与上一次相差（升）"],
    ["08:20", "1523.412", "—"],
    ["12:20", "1523.430", "18"],
    ["16:20", "1523.449", "19"],
  ],
};

const proposalDocx: DemoAttachment = {
  filename: "校园节水建议书.docx",
  title: "校园节水建议书：给一楼最里面的小便池换感应冲水阀",
  paragraphs: [
    "致总务处：",
    "问题：教学楼一层男生洗手间最里面的小便池一直在冲水，不管有没有人用。我们在第一阶段连续观察了 10 分钟，它没有停过。",
    "证据：第二阶段我们在 7:50、8:20、9:00 抄了三次这一层的分水表，分别是 214.36、214.52、214.71 吨。前半小时多用了 160 升，后 40 分钟多用了 190 升，大约每分钟 5 升。这段时间洗手间的人很少，所以大部分是这个小便池冲掉的。",
    "建议：把这个小便池的冲水阀换成感应式，有人用才冲。按每分钟 5 升、每天开放 10 小时、一周 5 天估算，一周大约能省 15 吨水。",
    "可能的反对意见：有人会说感应阀贵。我们查到一个感应冲水阀大约 200 元，按我们这里的水价，不到两个月就能省回来。",
    "我们还建议：换好以后再抄一次表，看看是不是真的省下来了。",
    "七年一班 黄子涵",
  ],
};

/**
 * The flagship class, one row per student. It is written so that each part of
 * the process diagnosis has something true to show:
 * - phase 2's photo (evidence 2) is ticked by two of eight, a task-book signal;
 * - 数据与证据 sits in the low band for three of six final evaluations, so the
 *   dimension is marked mostly weak;
 * - after "revise and resubmit" one student rises, one stays, one has not
 *   resubmitted yet;
 * - two students never started and one stopped half-way through phase 2;
 * - 黄子涵's final submission carries a Word proposal and has no evaluation
 *   yet, which is where the evaluation drafter's attachment reading shows.
 * Phase 1 has ten answers, phase 2 eight, phase 3 seven, so the answer
 * summary has at least three answers in every phase.
 */
const flagshipJourneys: readonly Journey[] = [
  {
    student: "chen",
    phases: [
      {
        text: "总务处让我们先去现场看。课间 08:05–08:20，我在教学楼一层洗手间守了 15 分钟：11 人洗手后没关紧水龙头，水槽一直滴。这里最像每天都在漏水。",
        feedback: {
          body: "观察员已经把地点和时间钉住了。下一阶段请用可比较的数据说明这是偶发还是反复发生，别只停在现象。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "目前只有上午这一组观察，还不能告诉总务处是不是全天都在浪费水。",
        feedback: {
          body: "证据偏少。请补一组下午观察，或加简单问卷，再用来说服总务处。",
          nextStep: "REVISE",
          supportLevel: "FOUNDATION",
        },
        resubmit: {
          text: "补做下午 16:00–16:20：同一水槽又滴了 7 次；问卷 18 人里 12 人说偶尔不关紧。读数表在附件里：上午、中午、下午三次抄表，每四小时约滴走 18 升，按每天开放 12 小时算，一周约 270 升。两组数据都指向洗手后未关紧，不是偶发。",
          evidence: [1, 2],
          attachment: readingsTable,
          feedback: {
            body: "下午数据、问卷和读数表已经能支撑判断。可以把建议写给总务处了。",
            nextStep: "CONTINUE",
            supportLevel: "STANDARD",
          },
        },
      },
      {
        text: "建议总务处在洗手池加装感应阀；班会用观察表把“关紧水龙头”的动作讲给同学。两条都对着同一组现场证据：这一个水槽一周约滴走 270 升。",
        feedback: {
          body: "对象已经是总务处。可再补一条给低年级的提示方式，公示栏会更好用。",
          nextStep: "CONTINUE",
          supportLevel: "CHALLENGE",
        },
        evaluation: {
          summary:
            "建议书把感应阀和班会提示两条措施都对准了洗手间的读数，一周约 270 升的估算能追到读数表，可以直接贴上公示栏。再回应一条可能的反对意见，会更有说服力。",
          levels: ["excellent", "good", "good", "excellent"],
        },
      },
    ],
  },
  {
    student: "li",
    phases: [
      {
        text: "我选了绿化浇灌区。星期二早晨喷灌喷到路面，积水很明显，像每天都在浪费。",
        feedback: {
          body: "场景清楚。下一阶段用时长和说明书对比，给总务处看。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "记录喷灌 12 分钟，路面积水大约 3 米。说明书建议 8 分钟，多出来的时间都喷到了路面。",
        feedback: {
          body: "时长对比已经能说明问题。下一步把多喷的 4 分钟换算成水量，建议书会更有力。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "建议物业按说明书改成 8 分钟喷灌，雨后停灌一天。这两条都对着超时喷到路面的证据。",
        feedback: {
          body: "建议可行。请把对象和执行步骤再写具体一些，并算出多喷的水有多少，再重交，公示时才知道谁来改、能省多少。",
          nextStep: "REVISE",
          supportLevel: "STANDARD",
        },
        evaluation: {
          summary:
            "建议对着喷灌超时的证据，方向可行。现在还缺两样：多喷的 4 分钟到底是多少水，以及由谁、从什么时候开始改。",
          levels: ["good", "improve", "pass", "improve"],
        },
        resubmit: {
          text: "补充：我借物业的流量表测了一次，喷头每分钟约 6 升，每次多喷 4 分钟就是 24 升，一周喷 5 次约 120 升。建议物业的王师傅从下周一起把定时器改成 8 分钟，雨后停灌一天；班里两名同学每周五去看一次路面有没有积水。",
          feedback: {
            body: "水量和执行人都补上了，这份建议物业拿到就能照着做。",
            nextStep: "CONTINUE",
            supportLevel: "STANDARD",
          },
          evaluation: {
            summary:
              "补上流量测量以后，一周约 120 升的数字能追到你自己的读数；执行人、开始时间和检查办法也写清了，建议可以直接交给物业。",
            levels: ["good", "good", "good", "good"],
          },
        },
      },
    ],
  },
  {
    student: "wang",
    phases: [
      {
        text: "饮水机接水区地面经常湿。我还没统计人数，暂时不能断定是哪一种浪费。",
        feedback: {
          body: "方向对。请补观察记录后再用数据说明，总务处现在还看不出规模。",
          nextStep: "CONTINUE",
          supportLevel: "FOUNDATION",
        },
      },
    ],
    unsubmitted: "正在整理问卷：接水区地面湿，还没写完人数和时段。",
  },
  {
    student: "liu",
    phases: [
      {
        text: "我选的是食堂洗碗池。中午 12:10 左右水龙头一直开着冲碗，有时候没人在洗也开着。",
        feedback: {
          body: "现场找得准。下一步请在同一个洗碗池连续记几次读数，看看没人洗的时候流走了多少。",
          nextStep: "CONTINUE",
          supportLevel: "FOUNDATION",
        },
      },
      {
        text: "我在 12:00 和 12:30 看了两次水表，差了 0.2 吨。所以一周大概浪费 1 吨。",
        evidence: [],
        feedback: {
          body: "有读数了。两次读数只能说明这半小时用了多少，还分不出哪些是浪费；写建议书时把这一点说清楚。",
          nextStep: "CONTINUE",
          supportLevel: "FOUNDATION",
        },
      },
      {
        text: "建议食堂装一个脚踏式水龙头，这样不用的时候就会关上，可以省很多水。",
        feedback: {
          body: "措施方向对。请把第二阶段的读数放进建议书，说明「省很多水」大约是多少、是怎么算出来的，再重交。",
          nextStep: "REVISE",
          supportLevel: "FOUNDATION",
        },
        evaluation: {
          summary:
            "建议抓住了洗碗池没人用也开着水的问题，脚踏式水龙头的方向可行。数据与证据这一项还看不到依据：建议书里没有用上你测到的读数，也没有说明「省很多水」是多少。",
          levels: ["pass", "insufficient", "pass", "improve"],
        },
      },
    ],
  },
  {
    student: "zhang",
    phases: [
      {
        text: "饮水机旁边的接水区。课间 10:00 我看到有同学接水接满了溢出来，地上一直是湿的，大约 10 分钟里溢出了 6 次。",
        feedback: {
          body: "现象和次数都记下了。下一步用水表读数算一算，溢出来的水一天有多少。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "08:00 读数 356.21 吨，10:00 读数 356.29 吨，两小时用了 80 升。其中溢出的我估计有一半，所以一周浪费 200 升。",
        evidence: [],
        feedback: {
          body: "有两个读数了，计算也清楚。「溢出一半」是怎么估出来的？写建议书时要交代。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "建议在接水区贴提示，并把出水按钮换成按一下出 300 毫升的定量款。预计一周能省 200 升。",
        feedback: {
          body: "两条措施都具体。「一周省 200 升」还缺依据，请补一次观察，说明溢出的比例是怎么来的，再重交。",
          nextStep: "REVISE",
          supportLevel: "STANDARD",
        },
        evaluation: {
          summary:
            "贴提示和定量出水两条措施都具体可做。「一周省 200 升」建立在「溢出一半」的估计上，这个比例还没有来源。",
          levels: ["good", "improve", "good", "pass"],
        },
        resubmit: {
          text: "补充：我又在 14:00–16:00 记了一次读数，用了 74 升。我觉得溢出的大概占四成，所以一周约 190 升。建议总务处先在一台饮水机上试用定量出水一周，看效果再推广。",
          feedback: {
            body: "先试一台再推广，这个想法很稳妥。",
            nextStep: "CONTINUE",
            supportLevel: "STANDARD",
          },
          evaluation: {
            summary:
              "先在一台饮水机上试用的建议更稳妥，表达也更完整了。数据还停在估计上：「溢出占四成」没有来源，可以数一数同一时段的接水次数和溢出次数，再算比例。",
            levels: ["good", "improve", "good", "good"],
          },
        },
      },
    ],
  },
  {
    student: "yang",
    phases: [
      {
        text: "拖把池的水龙头关不严，一直在细细地流。我放了一个杯子，1 分钟接了大约 50 毫升。",
        feedback: {
          body: "用杯子接水是个好办法。下一步换几个时间再接几次，看看是不是一直这样。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "我用量杯在 9:00、12:00、16:00 各接了 1 分钟：48、52、50 毫升，照片拍了量杯刻度。平均每分钟 50 毫升，一天 24 小时就是 72 升，一周约 504 升。",
        evidence: [1, 2],
        feedback: {
          body: "三个时间点的读数加照片，数据很扎实。可以写建议书了。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "建议总务处更换拖把池水龙头的阀芯，费用大约 30 元。按我们测的每分钟 50 毫升，一周能省约 500 升。",
        feedback: {
          body: "措施、费用和省水量都有了。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
        evaluation: {
          summary:
            "三个时间点的量杯读数和照片让一周约 500 升的数字很可信，阀芯更换的费用也写清了。如果再回应一条可能的反对意见（比如换阀芯要停水），建议书会更完整。",
          levels: ["good", "excellent", "good", "good"],
        },
      },
    ],
  },
  {
    student: "huang",
    phases: [
      {
        text: "教学楼一层男生洗手间最里面那个小便池一直在冲水，不管有没有人。我站了 10 分钟，它一直没停。",
        feedback: {
          body: "连续 10 分钟的观察很有说服力。下一步用水表算一算它一小时冲掉多少。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "我在 7:50、8:20、9:00 抄了三次那一层的分水表：214.36、214.52、214.71 吨。前半小时多用了 160 升，后面 40 分钟 190 升，差不多每分钟 5 升。按每天 10 小时算，一周 5 天约 15 吨。",
        feedback: {
          body: "三次读数，换算也清楚。写建议书时说明这段时间洗手间人少，数字会更站得住。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "我们的建议书放在附件里，主要建议是给最里面的小便池换感应冲水阀。",
        attachment: proposalDocx,
      },
    ],
  },
  {
    student: "zhou",
    phases: [
      {
        text: "食堂门口的洗手台，中午排队洗手的时候，有人把水开到最大，洗完不关就走了。",
        feedback: {
          body: "现象描述清楚。下一步试着用读数说明，这里一中午流走了多少水。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "12:00 读数 88.40 吨，12:40 读数 88.95 吨，40 分钟用了 550 升。不知道其中多少是浪费的。",
      },
    ],
  },
  {
    student: "wu",
    phases: [
      {
        text: "教学楼二楼洗手间，有一个水龙头的感应器坏了，手拿开以后还要流十几秒。",
        feedback: {
          body: "观察很细。可以想想：这十几秒加起来一天有多少？",
          nextStep: "CONTINUE",
          supportLevel: "CHALLENGE",
        },
      },
      {
        text: "我数了 20 分钟里有 31 个人用，每次多流大约 12 秒。没有读水表，我估计每秒流 0.1 升。",
        evidence: [],
        feedback: {
          body: "人数和秒数都有了，是很好的起点。每秒 0.1 升是估计，能不能用量杯接一次来验证？",
          nextStep: "CONTINUE",
          supportLevel: "CHALLENGE",
        },
      },
      {
        text: "建议维修感应水龙头，把延时调到 3 秒以内。每人省 9 秒，一天上千人次，能省很多水。也可以在旁边贴一张「感应龙头坏了请扫码报修」的二维码。",
        feedback: {
          body: "报修二维码这个想法很实用，别的洗手间也用得上。",
          nextStep: "CONTINUE",
          supportLevel: "CHALLENGE",
        },
        evaluation: {
          summary:
            "报修二维码很实用，把延时调到 3 秒以内也具体可做。数据还差一步：每秒 0.1 升是估计，「一天上千人次」也没有出处，用量杯接一次、再按你数到的人数推算，建议会更有说服力。",
          levels: ["good", "improve", "good", "good"],
        },
      },
    ],
  },
  {
    student: "xu",
    phases: [{ text: "我觉得学校最浪费水的是绿化浇水，草坪每天都在喷。" }],
  },
];

function flagshipSubmittedCount(): number {
  return flagshipJourneys.reduce((total, journey) => total + journey.phases.length, 0);
}

/** 校园植物身份证: open, with one group. */
const plantJourneys: readonly Journey[] = [
  {
    student: "wang",
    phases: [
      {
        text: "我们小组认领的是篮球场边上那棵树。叶子是长椭圆形，边缘有细锯齿，两片两片对着长，摸起来有点厚。现在没有开花。叶子正反面都拍了。",
        evidence: [1, 2],
        feedback: {
          body: "叶子的特征记得很全。下一步对照检索表时，「对生」这一条能帮你们排除很多种。",
          nextStep: "CONTINUE",
          supportLevel: "FOUNDATION",
        },
      },
    ],
  },
  {
    student: "chen",
    phases: [{ text: "我选的是校门口花坛里的灌木。叶子小小的、圆圆的，很密，修剪成了球形。没有花。" }],
  },
  {
    student: "li",
    phases: [
      {
        text: "图书馆后面有一棵很高的树，树皮一块一块地剥落，露出白色和绿色。叶子像手掌，有三到五个尖。地上有带刺的小球。",
        evidence: [1, 2],
        feedback: {
          body: "「带刺的小球」和剥落的树皮都是很关键的线索，检索时用得上。",
          nextStep: "CONTINUE",
          supportLevel: "STANDARD",
        },
      },
      {
        text: "按检索表：叶互生、掌状分裂；果实是带刺的球形聚合果，树皮片状剥落，所以是悬铃木科。一串上有三个小球，是三球悬铃木（法国梧桐）。资料：《中国植物志》网络版、生物课本第 45 页。容易混淆的是二球悬铃木，区别看一串几个球。它喜欢阳光，图书馆后面那片很开阔，所以长得高。",
      },
    ],
  },
  {
    student: "yang",
    phases: [
      {
        text: "操场边有一排树，叶子是针一样的。",
        feedback: {
          body: "「针一样」是个开始，但还认不出是哪一种。请补上针叶几根一束、大约多长、树皮是什么样，再拍一张特写后重交。",
          nextStep: "REVISE",
          supportLevel: "STANDARD",
        },
      },
    ],
  },
  {
    student: "wu",
    phases: [
      {
        text: "实验楼门口那棵开白花的树。花有香味，花瓣很厚，像小碗一样。叶子很大、亮亮的，边缘没有锯齿。",
        evidence: [1, 2],
        feedback: {
          body: "花和叶的特征都抓住了。检索时可以留意叶子背面，有些相似的树要靠它区分。",
          nextStep: "CONTINUE",
          supportLevel: "CHALLENGE",
        },
      },
      {
        text: "检索：单叶互生、全缘、革质；花大、单生、白色，所以是木兰科。叶背有锈色短毛，花期在夏天，是荷花玉兰（广玉兰）。容易混淆的是白玉兰，但白玉兰先开花后长叶、冬天落叶，这棵是常绿的。资料：中国植物图像库、《园林绿化手册》。它在楼前背风向阳的地方，土比较厚，所以长得好。",
        feedback: {
          body: "用叶背的锈色短毛排除白玉兰，依据很扎实。可以做身份证了。",
          nextStep: "CONTINUE",
          supportLevel: "CHALLENGE",
        },
      },
      {
        text: "名牌：荷花玉兰（广玉兰），木兰科木兰属。一句话：它的叶子背面有一层锈色的绒毛，摸摸看！扫码页面分三段已经做好，照片都是我自己拍的，资料来源写在最后。试读：请隔壁班同学读了一遍，他说「全缘」看不懂，我改成了「叶子边缘是光滑的」。",
        evidence: [1, 2],
      },
    ],
  },
];

/** 家乡老物件展: one-shot, evaluated, then closed. */
const objectSubmissions: readonly (Readonly<{ student: DemoStudentKey; text: string }> &
  Readonly<{ feedback: FeedbackStep; evaluation: EvaluationStep }>)[] = [
  {
    student: "chen",
    text: "这是外公家的一台蝴蝶牌缝纫机。外公说：「是 1978 年你外婆结婚时买的，当时要凭票。」机身上印着「上海缝纫机一厂」。我查了上海地方志里的轻工业资料，蝴蝶牌是六七十年代的名牌，和外公说的年代对得上。以前家里衣服都是自己做，现在基本都买成衣了。\n展签：这台蝴蝶牌缝纫机是 1978 年凭票买来的嫁妆，外婆用它给全家做了二十多年衣服。它见证了家里从「自己缝」到「直接买」的变化。",
    feedback: {
      body: "外公的原话和地方志对上了年代，展签三句话分工清楚。",
      nextStep: "CONTINUE",
      supportLevel: "STANDARD",
    },
    evaluation: {
      summary:
        "外公的口述和地方志里的资料互相印证，年代判断有依据；展签从物件写到故事再写到变化，观众半分钟就能读完。",
      levels: ["excellent", "good", "excellent", "good"],
    },
  },
  {
    student: "li",
    text: "我家的老物件是一台黑白电视机。爷爷说是 80 年代初买的，当时全村只有两三台，晚上邻居都来我家看。电视机背面印着生产日期 1983 年 6 月。\n展签：这台黑白电视是 1983 年的，那时候全村的人都来我家看电视。现在家家都有彩电和手机了。",
    feedback: {
      body: "生产日期和爷爷的回忆对上了，邻居都来看电视的细节很生动。",
      nextStep: "CONTINUE",
      supportLevel: "STANDARD",
    },
    evaluation: {
      summary:
        "背面的生产日期和爷爷的回忆互相印证，邻居来看电视的细节很生动。展示卡上的照片可以再拍一张特写，让观众看清旋钮和屏幕。",
      levels: ["good", "good", "good", "pass"],
    },
  },
  {
    student: "zhang",
    text: "奶奶的粮票夹子，里面还夹着几张粮票。奶奶说一直用到 90 年代初。粮票上印着 1985 年。我在博物馆网站上看到，全国粮票大约在 1993 年前后停止使用。\n展签：这些粮票是奶奶当年买米买面必须用的，1993 年前后停止使用。它告诉我们，以前买粮食不光要钱还要票。",
    feedback: {
      body: "用博物馆资料核对了停用年份，展签把变化说得很明白。",
      nextStep: "CONTINUE",
      supportLevel: "STANDARD",
    },
    evaluation: {
      summary:
        "粮票上的年份、奶奶的回忆和博物馆资料三方对得上，展签把「买粮食还要票」的变化说得很明白。",
      levels: ["excellent", "good", "good", "good"],
    },
  },
  {
    student: "wu",
    text: "姥姥的搪瓷脸盆，上面印着红双喜和「1976」。姥姥说是结婚时单位发的。\n展签：一只印着红双喜的搪瓷盆。",
    feedback: {
      body: "年份和来历都找到了。展签可以再多写一句它背后的故事，或者它说明了什么变化。",
      nextStep: "CONTINUE",
      supportLevel: "FOUNDATION",
    },
    evaluation: {
      summary:
        "盆上的「1976」和姥姥的回忆对得上。展签现在只写了它是什么，还没有说出背后的故事和它反映的变化，比如为什么单位会发脸盆。",
      levels: ["pass", "improve", "improve", "pass"],
    },
  },
];

type Submitted = { submissionId: string; revisionId: string; revisionNumber: number };

async function review(
  database: PrismaClient,
  teacherId: string,
  title: string,
  submitted: Submitted,
  step: { feedback?: FeedbackStep; evaluation?: EvaluationStep },
  clock: Clock,
) {
  if (step.feedback) {
    await giveFeedback(
      database,
      teacherId,
      submitted,
      step.feedback.body,
      step.feedback.nextStep,
      step.feedback.supportLevel,
      clock,
    );
  }
  if (step.evaluation) {
    await giveEvaluation(
      database,
      teacherId,
      submitted,
      step.evaluation.summary,
      covering(title, step.evaluation.levels),
      clock,
    );
  }
}

/**
 * Plays one phase for the whole class: every first submission and its review,
 * then every resubmission. Played phase by phase, the timeline puts the class's
 * phase 1 before its phase 2, the way a class actually works through a task.
 */
async function runPhase(
  database: PrismaClient,
  teacherId: string,
  release: { releaseId: string; title: string },
  studentIds: Record<DemoStudentKey, string>,
  journeys: readonly Journey[],
  phaseNumber: number,
  clock: Clock,
) {
  const reopened = new Map<DemoStudentKey, Submitted>();
  for (const journey of journeys) {
    const studentId = studentIds[journey.student];
    const step = journey.phases[phaseNumber - 1];
    if (step) {
      const submitted = await submitPhase(
        database,
        studentId,
        release.releaseId,
        phaseNumber,
        step,
        clock,
      );
      await review(database, teacherId, release.title, submitted, step, clock);
      if (step.resubmit) reopened.set(journey.student, submitted);
    } else if (journey.unsubmitted && journey.phases.length + 1 === phaseNumber) {
      await saveDraftOnly(
        database,
        studentId,
        release.releaseId,
        phaseNumber,
        journey.unsubmitted,
        clock,
      );
    }
  }
  for (const journey of journeys) {
    const step = journey.phases[phaseNumber - 1];
    const first = reopened.get(journey.student);
    if (!step?.resubmit || !first) continue;
    const again = await resubmitPhase(
      database,
      studentIds[journey.student],
      release.releaseId,
      phaseNumber,
      first,
      step.resubmit,
      clock,
    );
    await review(database, teacherId, release.title, again, step.resubmit, clock);
  }
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
  const timeline = new Timeline();
  timeline.mark(26);

  try {
    await ensureDemoAdminCredential(database, clock);
    const teacherIdentifier = stagingLocalIdentifier({
      schoolCode: legacySchoolCode,
      role: "TEACHER",
      staffNo: DEMO_TEACHER_STAFF_NO,
    });
    const teacherIdentity = {
      schoolCode: legacySchoolCode,
      identifier: teacherIdentifier,
      password: DEMO_TEACHER_PASSWORD,
      displayName: DEMO_TEACHER_NAME,
      role: "TEACHER" as const,
      staffNo: DEMO_TEACHER_STAFF_NO,
    };
    const studentIdentity = (student: { studentNo: string; displayName: string }) => ({
      schoolCode: legacySchoolCode,
      identifier: stagingLocalIdentifier({
        schoolCode: legacySchoolCode,
        role: "STUDENT",
        studentNo: student.studentNo,
      }),
      password: DEMO_STUDENT_PASSWORD,
      displayName: student.displayName,
      role: "STUDENT" as const,
      studentNo: student.studentNo,
    });
    const loginStudent = studentIdentity({
      studentNo: DEMO_LOGIN_STUDENT_NO,
      displayName: DEMO_LOGIN_STUDENT_NAME,
    });
    const classOne = [loginStudent, ...extraStudents.map(studentIdentity)];
    const classTwo = secondClassStudents.map(studentIdentity);
    const school = { code: legacySchoolCode, name: "历史迁移学校", status: "ACTIVE" as const };

    await bootstrapLocalStaging(database, {
      schools: [school],
      identities: [teacherIdentity, ...classOne],
      classroom: {
        id: DEMO_CLASSROOM_ID,
        name: DEMO_CLASSROOM_NAME,
        teacherIdentifier,
        studentIdentifiers: classOne.map((student) => student.identifier),
      },
    });
    await bootstrapLocalStaging(database, {
      schools: [school],
      identities: [teacherIdentity, ...classTwo],
      classroom: {
        id: SECOND_CLASSROOM_ID,
        name: SECOND_CLASSROOM_NAME,
        teacherIdentifier,
        studentIdentifiers: classTwo.map((student) => student.identifier),
      },
    });

    const teacherId = await findLocalIdentityId(database, teacherIdentifier);
    const studentIds = {
      chen: await findLocalIdentityId(database, loginStudent.identifier),
    } as Record<DemoStudentKey, string>;
    for (const [index, student] of extraStudents.entries()) {
      studentIds[student.key] = await findLocalIdentityId(
        database,
        classOne[index + 1]!.identifier,
      );
    }
    await setStudentRosterKeys(database, [
      { identifier: loginStudent.identifier, rosterKey: "DEMOSTU01" },
      ...extraStudents.map((student, index) => ({
        identifier: classOne[index + 1]!.identifier,
        rosterKey: student.rosterKey,
      })),
      ...secondClassStudents.map((student, index) => ({
        identifier: classTwo[index]!.identifier,
        rosterKey: student.rosterKey,
      })),
    ]);
    const teacher = await database.appUser.findUniqueOrThrow({
      where: { id: teacherId },
      select: { id: true, displayName: true },
    });

    const stale = await demoContentIsStale(database, teacher.id);
    const leftoverPrefixed = await database.activityDraft.findFirst({
      where: {
        ownerId: teacher.id,
        title: { startsWith: LEGACY_DEMO_PREFIX },
      },
      select: { id: true },
    });
    if (reset || stale || leftoverPrefixed) {
      await resetDemoActivities(database, teacher.id);
    }
    const existingComplete = await findDraftRelease(database, teacher.id, COMPLETE_TITLE);
    const existingLive = await findDraftRelease(database, teacher.id, LIVE_TITLE);
    const existingClosed = await findDraftRelease(database, teacher.id, CLOSED_TITLE);
    const existingCopy = await findDraftRelease(database, teacher.id, COPY_TITLE);
    const login = {
      teacher: teacher.displayName,
      student: DEMO_LOGIN_STUDENT_NAME,
      classrooms: [DEMO_CLASSROOM_NAME, SECOND_CLASSROOM_NAME],
    };
    if (
      (existingComplete?.release?._count.submissions ?? 0) > 0 &&
      existingLive?.release &&
      existingClosed?.release &&
      existingCopy
    ) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            skipped: true,
            reason: "DEMO_ALREADY_SEEDED",
            databaseTarget: target.redactedTarget,
            login,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const membershipJoinedAt = clock.now();
    for (const studentId of Object.values(studentIds)) {
      await ensureMembership(database, DEMO_CLASSROOM_ID, studentId, membershipJoinedAt);
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
    timeline.mark(24);

    // 家乡老物件展 came first and is long over.
    const closed = await publishDemoActivity(database, {
      teacherId: teacher.id,
      classroomId: DEMO_CLASSROOM_ID,
      title: CLOSED_TITLE,
      existing: existingClosed,
      clock,
    });
    timeline.mark(21);
    if (!existingClosed?.release) {
      for (const item of objectSubmissions) {
        const submitted = await submitPhase(
          database,
          studentIds[item.student],
          closed.releaseId,
          0,
          { text: item.text },
          clock,
        );
        await review(database, teacher.id, CLOSED_TITLE, submitted, item, clock);
      }
      timeline.mark(17);
      await closePublishedActivity(database, {
        teacherId: teacher.id,
        releaseId: closed.releaseId,
        closedAt: clock.tick(),
      });
    }
    timeline.mark(16);

    // 校园节水行动: two weeks in, due in a day and a half.
    const complete = await publishDemoActivity(database, {
      teacherId: teacher.id,
      classroomId: DEMO_CLASSROOM_ID,
      title: COMPLETE_TITLE,
      existing: existingComplete,
      clock,
      dueAt: new Date(Date.now() + 1.5 * DAY_MS),
    });
    timeline.mark(14);
    const flagship = { releaseId: complete.releaseId, title: COMPLETE_TITLE };
    const playFlagship = (existingComplete?.release?._count.submissions ?? 0) === 0;
    if (playFlagship) {
      await runPhase(database, teacher.id, flagship, studentIds, flagshipJourneys, 1, clock);
    }
    timeline.mark(10);
    if (playFlagship) {
      await runPhase(database, teacher.id, flagship, studentIds, flagshipJourneys, 2, clock);
    }
    timeline.mark(6);

    // 校园植物身份证 opens while the flagship is in its last phase.
    const live = await publishDemoActivity(database, {
      teacherId: teacher.id,
      classroomId: DEMO_CLASSROOM_ID,
      title: LIVE_TITLE,
      existing: existingLive,
      clock,
      dueAt: new Date(Date.now() + 10 * DAY_MS),
    });
    const plants = { releaseId: live.releaseId, title: LIVE_TITLE };
    const playPlants = !existingLive?.release;
    if (playPlants) {
      await saveReleaseGroup(database, context(teacher.id, clock.tick()), {
        releaseId: live.releaseId,
        groupId: null,
        name: "植物档案组",
        members: [
          { studentId: studentIds.wang, roleLabel: "记录" },
          { studentId: studentIds.zhao, roleLabel: "汇报" },
        ],
        idempotencyKey: `demo_group_${randomUUID()}`,
      });
    }
    timeline.mark(5);
    if (playPlants) {
      await runPhase(database, teacher.id, plants, studentIds, plantJourneys, 1, clock);
    }
    timeline.mark(4);
    if (playFlagship) {
      await runPhase(database, teacher.id, flagship, studentIds, flagshipJourneys, 3, clock);
    }
    timeline.mark(1.3);
    if (playPlants) {
      await runPhase(database, teacher.id, plants, studentIds, plantJourneys, 2, clock);
    }
    timeline.mark(0.8);

    // The copy carries the flagship's classroom signals onto a draft (D-088),
    // and is what a teacher would adapt for 七年二班 (D-066).
    if (!existingCopy) {
      const snapshot = await database.activityReleaseSnapshot.findUniqueOrThrow({
        where: { releaseId: complete.releaseId },
        select: { sourceDraftVersion: true },
      });
      await copyActivityDraft(database, context(teacher.id, clock.tick()), {
        source: {
          kind: "RELEASE",
          id: complete.releaseId,
          version: snapshot.sourceDraftVersion,
        },
        title: COPY_TITLE,
        idempotencyKey: `demo_copy_${randomUUID()}`,
      });
    }
    timeline.mark(0.6);
    if (playPlants) {
      await runPhase(database, teacher.id, plants, studentIds, plantJourneys, 3, clock);
    }
    timeline.mark(0.3);
    await timeline.rewrite(database, [DEMO_CLASSROOM_ID, SECOND_CLASSROOM_ID]);

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          skipped: false,
          databaseTarget: target.redactedTarget,
          login: {
            ...login,
            note: "所有学生均使用 README 记录的固定本地演示凭据。",
          },
          seeded: {
            classrooms: {
              [DEMO_CLASSROOM_NAME]: classOne.length,
              [SECOND_CLASSROOM_NAME]: classTwo.length,
            },
            drafts: [EDITING_TITLE, READY_TITLE, COPY_TITLE],
            releases: [COMPLETE_TITLE, LIVE_TITLE, CLOSED_TITLE],
            attachments: createServerReceivedAttachmentStorage()
              ? "两份 Word 附件"
              : "已跳过：未启用 ATTACHMENT_STORAGE_ENABLED",
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
