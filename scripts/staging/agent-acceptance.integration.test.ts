import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  finishActivityAssistantRun,
  startActivityAssistantRun,
} from "../../src/server/assistant/agent-run-lifecycle";
import { bootstrapClerkClassroom } from "../../src/server/bootstrap/bootstrap-clerk-classroom";
import type {
  CommandContext,
  CommandSource,
} from "../../src/server/commands/command-context";
import { decideActionIntent } from "../../src/server/commands/decide-action-intent";
import { preparePublishActivityIntent } from "../../src/server/commands/prepare-publish-activity-intent";
import { publishActivityRelease } from "../../src/server/commands/publish-activity-release";
import { saveActivityDraft } from "../../src/server/commands/save-activity-draft";
import { createDatabaseClient } from "../../src/server/db/client";
import {
  agentAcceptanceActivityContent,
  agentAcceptanceNamespace,
  agentAcceptanceStudentDisplayName,
  agentAcceptanceTeacherDisplayName,
} from "./agent-acceptance/contracts";
import {
  evaluateAgentVerification,
  verificationSql,
  type VerificationRow,
} from "./agent-acceptance/verify";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

const model = "openai/test-agent";
const windowStartedAt = new Date("2026-08-23T05:00:00.000Z");
const windowCompletedAt = new Date("2026-08-23T05:01:00.000Z");

function context(
  actorId: string,
  source: CommandSource,
  now: Date,
): CommandContext {
  return {
    actorId,
    source,
    traceId: randomUUID(),
    clock: () => now,
  };
}

function idempotencyKey(kind: "draft" | "prepare" | "publish"): string {
  const digest = createHash("sha256").update(randomUUID()).digest("hex");
  return `assistant_${kind}_${digest.slice(0, 40)}`;
}

async function queryVerification(input: {
  classroomId: string;
  classroomName: string;
  activityTitle: string;
  teacherSubject: string;
  studentSubject: string;
}): Promise<VerificationRow> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query<VerificationRow>(verificationSql, [
      input.classroomId,
      input.classroomName,
      input.activityTitle,
      input.teacherSubject,
      input.studentSubject,
      model,
      windowStartedAt.toISOString(),
      windowCompletedAt.toISOString(),
      agentAcceptanceActivityContent.summary,
      agentAcceptanceActivityContent.learningObjectives[0],
      agentAcceptanceActivityContent.taskInstructions,
      agentAcceptanceActivityContent.evidenceRequirements[0],
      agentAcceptanceActivityContent.feedbackCriteria[0],
    ]);
    await client.query("ROLLBACK");
    if (!result.rows[0]) throw new Error("AGENT_VERIFICATION_ROW_REQUIRED");
    return result.rows[0];
  } finally {
    await client.end();
  }
}

describeWithDatabase("staging Agent acceptance read-only verifier", () => {
  afterAll(async () => database?.$disconnect());

  it("accepts only one marker draft and exactly three session runs", async () => {
    if (!database) throw new Error("TEST_DATABASE_URL is required");

    const marker = `cdas-staging-agent-${randomUUID().replaceAll("-", "")}`;
    const namespace = agentAcceptanceNamespace(marker);
    const suffix = randomUUID().replaceAll("-", "");
    const teacherSubject = `user_agentteacher${suffix}`;
    const studentSubject = `user_agentstudent${suffix}`;
    const resources = await bootstrapClerkClassroom(database, {
      teacherAuthSubject: teacherSubject,
      teacherDisplayName: agentAcceptanceTeacherDisplayName,
      studentAuthSubject: studentSubject,
      studentDisplayName: agentAcceptanceStudentDisplayName,
      classroomId: namespace.classroomId,
      classroomName: namespace.classroomName,
    });

    const run1 = await startActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:05.000Z"),
      ),
      { model },
    );
    const saved = await saveActivityDraft(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:10.000Z"),
      ),
      {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "READY_FOR_PREVIEW",
        content: {
          schemaVersion: 1,
          title: namespace.activityTitle,
          summary: agentAcceptanceActivityContent.summary,
          learningObjectives: [
            agentAcceptanceActivityContent.learningObjectives[0],
          ],
          taskInstructions: agentAcceptanceActivityContent.taskInstructions,
          evidenceRequirements: [
            agentAcceptanceActivityContent.evidenceRequirements[0],
          ],
          feedbackCriteria: [
            agentAcceptanceActivityContent.feedbackCriteria[0],
          ],
        },
        agentRunId: run1.id,
        idempotencyKey: idempotencyKey("draft"),
      },
    );

    const run2 = await startActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:20.000Z"),
      ),
      { model },
    );
    await finishActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:25.000Z"),
      ),
      { agentRunId: run2.id, status: "SUCCEEDED", failureCode: null },
    );

    const run3 = await startActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:30.000Z"),
      ),
      { model },
    );
    const prepared = await preparePublishActivityIntent(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:35.000Z"),
      ),
      {
        draftId: saved.draftId,
        expectedDraftVersion: 1,
        classroomId: namespace.classroomId,
        dueAt: null,
        agentRunId: run3.id,
        idempotencyKey: idempotencyKey("prepare"),
      },
    );
    await decideActionIntent(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:40.000Z"),
      ),
      { actionIntentId: prepared.actionIntentId, decision: "CONFIRM" },
    );
    await publishActivityRelease(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:45.000Z"),
      ),
      {
        actionIntentId: prepared.actionIntentId,
        idempotencyKey: idempotencyKey("publish"),
      },
    );

    const scope = {
      classroomId: namespace.classroomId,
      classroomName: namespace.classroomName,
      activityTitle: namespace.activityTitle,
      teacherSubject,
      studentSubject,
    };
    const passing = evaluateAgentVerification(await queryVerification(scope));
    expect(passing.every((candidate) => candidate.status === "PASS")).toBe(
      true,
    );

    await saveActivityDraft(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:47.000Z"),
      ),
      {
        draftId: null,
        expectedVersion: null,
        desiredStatus: "EDITING",
        content: {
          schemaVersion: 1,
          title: namespace.activityTitle,
          summary: agentAcceptanceActivityContent.summary,
          learningObjectives: [
            agentAcceptanceActivityContent.learningObjectives[0],
          ],
          taskInstructions: agentAcceptanceActivityContent.taskInstructions,
          evidenceRequirements: [
            agentAcceptanceActivityContent.evidenceRequirements[0],
          ],
          feedbackCriteria: [
            agentAcceptanceActivityContent.feedbackCriteria[0],
          ],
        },
        agentRunId: null,
        idempotencyKey: `manual_duplicate_${randomUUID()}`,
      },
    );

    const duplicateDraft = evaluateAgentVerification(
      await queryVerification(scope),
    );
    expect(duplicateDraft).toContainEqual({
      code: "EXACT_SEALED_DRAFT_AND_REVISION",
      status: "FAIL",
    });
    expect(duplicateDraft).toContainEqual({
      code: "EXACT_THREE_AGENT_RUNS",
      status: "PASS",
    });

    const extraRun = await startActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "UI",
        new Date("2026-08-23T05:00:50.000Z"),
      ),
      { model },
    );
    await finishActivityAssistantRun(
      database,
      context(
        resources.teacher.id,
        "AGENT",
        new Date("2026-08-23T05:00:55.000Z"),
      ),
      { agentRunId: extraRun.id, status: "SUCCEEDED", failureCode: null },
    );

    const tampered = evaluateAgentVerification(await queryVerification(scope));
    expect(tampered).toContainEqual({
      code: "EXACT_THREE_AGENT_RUNS",
      status: "FAIL",
    });
  });
});
