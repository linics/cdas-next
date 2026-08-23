import { randomUUID } from "node:crypto";
import type { ActivityContent } from "../../domain/activity/activity-content";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../../server/commands/command-context";
import { decideActionIntent } from "../../server/commands/decide-action-intent";
import { closeActivityRelease } from "../../server/commands/close-activity-release";
import { prepareCloseActivityIntent } from "../../server/commands/prepare-close-activity-intent";
import { preparePublishActivityIntent } from "../../server/commands/prepare-publish-activity-intent";
import { publishActivityRelease } from "../../server/commands/publish-activity-release";
import { saveActivityDraft } from "../../server/commands/save-activity-draft";

const defaultContent: ActivityContent = {
  schemaVersion: 1,
  title: "测试活动",
  summary: "供集成测试发布的活动。",
  learningObjectives: ["使用证据说明观察结果"],
  taskInstructions: "完成观察并提交一项文字证据。",
  evidenceRequirements: ["至少包含一项可核验记录"],
  feedbackCriteria: ["证据与结论一致"],
};

export type PublishedActivityOptions = {
  teacherId: string;
  classroomId: string;
  publishedAt: Date;
  dueAt?: Date | null;
  content?: ActivityContent;
  draft?: { draftId: string; version: number };
};

function context(actorId: string, now: Date): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}

/** Creates a legally published release; callers may supply an existing ready draft. */
export async function createPublishedActivity(
  database: PrismaClient,
  options: PublishedActivityOptions,
) {
  const draft =
    options.draft ??
    (await saveActivityDraft(database, context(options.teacherId, options.publishedAt), {
      draftId: null,
      expectedVersion: null,
      desiredStatus: "READY_FOR_PREVIEW",
      content: options.content ?? defaultContent,
      agentRunId: null,
      idempotencyKey: `fixture_draft_${randomUUID()}`,
    }));
  const prepared = await preparePublishActivityIntent(
    database,
    context(options.teacherId, options.publishedAt),
    {
      draftId: draft.draftId,
      expectedDraftVersion: draft.version,
      classroomId: options.classroomId,
      dueAt: options.dueAt?.toISOString() ?? null,
      agentRunId: null,
      idempotencyKey: `fixture_prepare_publish_${randomUUID()}`,
    },
  );
  await decideActionIntent(database, context(options.teacherId, options.publishedAt), {
    actionIntentId: prepared.actionIntentId,
    decision: "CONFIRM",
  });
  const release = await publishActivityRelease(
    database,
    context(options.teacherId, options.publishedAt),
    {
      actionIntentId: prepared.actionIntentId,
      idempotencyKey: `fixture_publish_${randomUUID()}`,
    },
  );

  return { ...release, draftId: draft.draftId, draftVersion: draft.version };
}

export async function closePublishedActivity(
  database: PrismaClient,
  options: { teacherId: string; releaseId: string; closedAt: Date },
) {
  const prepared = await prepareCloseActivityIntent(
    database,
    context(options.teacherId, options.closedAt),
    {
      releaseId: options.releaseId,
      expectedStatus: "ACTIVE",
      idempotencyKey: `fixture_prepare_close_${randomUUID()}`,
    },
  );
  await decideActionIntent(database, context(options.teacherId, options.closedAt), {
    actionIntentId: prepared.actionIntentId,
    decision: "CONFIRM",
  });
  return closeActivityRelease(database, context(options.teacherId, options.closedAt), {
    actionIntentId: prepared.actionIntentId,
    idempotencyKey: `fixture_close_${randomUUID()}`,
  });
}
