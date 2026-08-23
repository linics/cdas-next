import { createDatabaseClient } from "../../src/server/db/client";
import { bootstrapClerkClassroom } from "../../src/server/bootstrap/bootstrap-clerk-classroom";
import type { PrismaClient } from "../../src/generated/prisma/client";
import {
  resolveBootstrapDatabaseTarget,
  serializeBootstrapClerkCliError,
  serializeBootstrapClerkCliSuccess,
} from "../../src/server/bootstrap/bootstrap-clerk-cli";
import {
  e2eDatabaseName,
  loadE2eEnvironment,
  requireNonProductionClerkForE2e,
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
          authSubject: "user_E2EForeignTeacherFixture",
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
  requireNonProductionClerkForE2e();
  const connectionString = resolveE2eDatabaseUrl();
  const target = resolveBootstrapDatabaseTarget(
    { databaseUrl: connectionString },
    e2eDatabaseName,
  );
  const database = createDatabaseClient(connectionString);

  try {
    const result = await bootstrapClerkClassroom(database, {
      teacherAuthSubject: requireEnvironmentValue(
        "DEV_TEST_TEACHER_CLERK_ID",
      ),
      teacherDisplayName: "E2E 验收教师",
      studentAuthSubject: requireEnvironmentValue(
        "DEV_TEST_STUDENT_CLERK_ID",
      ),
      studentDisplayName: "E2E 验收学生",
      classroomId,
      classroomName: "E2E 验收班级",
    });
    await seedForeignOwnedDraft(database);
    process.stdout.write(
      `${serializeBootstrapClerkCliSuccess(target, result)}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${serializeBootstrapClerkCliError(error)}\n`);
  process.exitCode = 1;
});
