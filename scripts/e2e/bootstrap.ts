import { createDatabaseClient } from "../../src/server/db/client";
import { bootstrapLocalClassroom } from "../../src/server/bootstrap/bootstrap-local-classroom";
import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  resolveBootstrapDatabaseTarget,
} from "../../src/server/bootstrap/bootstrap-database-cli";
import {
  e2eDatabaseName,
  loadE2eEnvironment,
  resolveE2eDatabaseUrl,
} from "./environment";
import {
  foreignDraftId,
  foreignDraftTitle,
  foreignTeacherId,
} from "./fixtures";

const classroomId = "20000000-0000-4000-8000-000000000001";

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name}_REQUIRED`);
  }
  return value;
}

async function seedForeignOwnedDraft(database: PrismaClient): Promise<void> {
  await database.$transaction(async (transaction) => {
    const existingTeacher = await transaction.appUser.findUnique({
      where: { id: foreignTeacherId },
      select: { role: true, displayName: true },
    });
    if (!existingTeacher) {
      await transaction.appUser.create({
        data: {
          id: foreignTeacherId,
          authSubject: `local:${foreignTeacherId}`,
          role: "TEACHER",
          displayName: "E2E 其他教师",
        },
      });
    } else if (
      existingTeacher.role !== "TEACHER" ||
      existingTeacher.displayName !== "E2E 其他教师"
    ) {
      throw new Error("E2E_FOREIGN_TEACHER_FIXTURE_CONFLICT");
    }

    const existingDraft = await transaction.activityDraft.findUnique({
      where: { id: foreignDraftId },
      select: {
        ownerId: true,
        title: true,
        version: true,
        status: true,
        revisions: { select: { version: true } },
      },
    });
    if (!existingDraft) {
      await transaction.activityDraft.create({
        data: {
          id: foreignDraftId,
          ownerId: foreignTeacherId,
          status: "EDITING",
          version: 1,
          title: foreignDraftTitle,
          summary: "只用于验证同角色资源级隔离。",
          learningObjectives: ["验证资源所有权"],
          taskInstructions: "当前登录教师不得读取这份草稿。",
          evidenceRequirements: ["返回 404"],
          feedbackCriteria: ["不泄露草稿内容"],
          revisions: {
            create: {
              version: 1,
              source: "MANUAL",
              title: foreignDraftTitle,
              summary: "只用于验证同角色资源级隔离。",
              learningObjectives: ["验证资源所有权"],
              taskInstructions: "当前登录教师不得读取这份草稿。",
              evidenceRequirements: ["返回 404"],
              feedbackCriteria: ["不泄露草稿内容"],
            },
          },
        },
      });
    } else if (
      existingDraft.ownerId !== foreignTeacherId ||
      existingDraft.title !== foreignDraftTitle ||
      existingDraft.version !== 1 ||
      existingDraft.status !== "EDITING" ||
      existingDraft.revisions.length !== 1 ||
      existingDraft.revisions[0]?.version !== 1
    ) {
      throw new Error("E2E_FOREIGN_DRAFT_FIXTURE_CONFLICT");
    }
  });
}

async function main(): Promise<void> {
  loadE2eEnvironment();
  const connectionString = resolveE2eDatabaseUrl();
  const target = resolveBootstrapDatabaseTarget(
    { databaseUrl: connectionString },
    e2eDatabaseName,
  );
  const database = createDatabaseClient(connectionString);

  try {
    const result = await bootstrapLocalClassroom(database, {
      teacherStaffNo: requireEnvironmentValue("E2E_TEACHER_STAFF_NO"),
      teacherPassword: requireEnvironmentValue("E2E_TEACHER_PASSWORD"),
      studentNo: requireEnvironmentValue("E2E_STUDENT_NO"),
      studentPassword: requireEnvironmentValue("E2E_STUDENT_PASSWORD"),
      teacherDisplayName: "E2E 验收教师",
      studentDisplayName: "E2E 验收学生",
      classroomId,
      classroomName: "E2E 验收班级",
    });
    await seedForeignOwnedDraft(database);
    process.stdout.write(
      `${JSON.stringify({ database: target.redactedTarget, ...result })}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "E2E_BOOTSTRAP_FAILED"}\n`);
  process.exitCode = 1;
});
