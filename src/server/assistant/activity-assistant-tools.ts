import "server-only";

import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { activityContentV2Schema } from "../../domain/activity/activity-content";
import { publishDueAtSchema } from "../../domain/activity/prepare-publish-intent";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  decideActionIntent,
  DecideActionIntentError,
} from "../commands/decide-action-intent";
import {
  preparePublishActivityIntent,
  PreparePublishActivityIntentError,
} from "../commands/prepare-publish-activity-intent";
import {
  publishActivityRelease,
  PublishActivityReleaseError,
} from "../commands/publish-activity-release";
import {
  saveActivityDraft,
  SaveActivityDraftError,
} from "../commands/save-activity-draft";
import type { CommandContext } from "../commands/command-context";

export const publishActivityToolInputSchema = z
  .object({
    draftId: z.uuid(),
    expectedDraftVersion: z.int().positive(),
    classroomId: z.uuid(),
    dueAt: publishDueAtSchema.nullable(),
  })
  .strict();

const proposalText = z.string().trim().min(1).max(600);

const taskUnderstandingSummarySchema = z
  .object({
    realWorldContext: proposalText,
    studentAction: proposalText,
    intendedOutcome: proposalText,
    evidenceAndAssessment: proposalText,
  })
  .strict();

const integratedDisciplineContributionSchema = z
  .object({
    disciplineCode: z.string().trim().min(1).max(40),
    necessaryContribution: proposalText,
  })
  .strict();

const alignmentChainSchema = z
  .object({
    objectiveKind: z.enum(["knowledge", "process", "emotion"]),
    objective: proposalText,
    task: proposalText,
    evidence: proposalText,
    assessment: proposalText,
  })
  .strict();

/**
 * The L1 design proposal is intentionally a narrow, one-shot artifact. It is
 * not stored as a separate business entity: the teacher either approves this
 * exact input and creates its editable v2 draft, or rejects it without a
 * write. The content remains the sole persisted task book.
 */
export const activityDraftProposalSchema = z
  .object({
    taskUnderstandingSummary: taskUnderstandingSummarySchema,
    teacherRequirements: z.array(proposalText).min(1).max(12),
    assumptions: z.array(proposalText).max(8),
    integratedDisciplineContributions: z
      .array(integratedDisciplineContributionSchema)
      .min(1)
      .max(14),
    alignmentChains: z.array(alignmentChainSchema).length(3),
    content: activityContentV2Schema,
  })
  .strict()
  .superRefine((proposal, context) => {
    const expectedDisciplines = new Set(proposal.content.integratedDisciplineCodes);
    const suppliedDisciplines = proposal.integratedDisciplineContributions.map(
      (item) => item.disciplineCode,
    );
    const suppliedSet = new Set(suppliedDisciplines);
    if (
      suppliedSet.size !== suppliedDisciplines.length ||
      suppliedSet.size !== expectedDisciplines.size ||
      [...expectedDisciplines].some((code) => !suppliedSet.has(code))
    ) {
      context.addIssue({
        code: "custom",
        path: ["integratedDisciplineContributions"],
        message:
          "Integrated discipline contributions must cover each integrated discipline exactly once",
      });
    }

    const kinds = proposal.alignmentChains.map((chain) => chain.objectiveKind);
    if (
      new Set(kinds).size !== 3 ||
      !["knowledge", "process", "emotion"].every((kind) =>
        kinds.includes(kind as (typeof kinds)[number]),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["alignmentChains"],
        message:
          "Alignment chains must contain knowledge, process, and emotion exactly once",
      });
    }
  });

export type ActivityDraftProposal = z.infer<typeof activityDraftProposalSchema>;

export const createdDraftToolOutputSchema = z
  .object({
    draftId: z.uuid(),
    version: z.int().positive(),
    status: z.literal("READY_FOR_PREVIEW"),
    editHref: z.string().regex(/^\/teacher\/activities\/[0-9a-f-]{36}$/),
    previewHref: z
      .string()
      .regex(/^\/teacher\/activities\/[0-9a-f-]{36}\/preview$/),
  })
  .strict();

export const publishActivityToolOutputSchema = z
  .object({
    releaseId: z.uuid(),
    status: z.literal("PUBLISHED"),
    publishedAt: z.iso.datetime({ offset: true }),
    releaseHref: z
      .string()
      .regex(/^\/teacher\/releases\/[0-9a-f-]{36}\/submissions$/),
  })
  .strict();

/**
 * Schema-only registry used to validate client-controlled UI message history
 * before an AgentRun is opened. It deliberately has no execute functions.
 */
export const activityAssistantMessageValidationTools = {
  create_activity_draft: tool({
    inputSchema: activityDraftProposalSchema,
    outputSchema: createdDraftToolOutputSchema,
    strict: true,
  }),
  publish_activity_release: tool({
    inputSchema: publishActivityToolInputSchema,
    outputSchema: publishActivityToolOutputSchema,
    strict: true,
  }),
};

type ActivityAssistantCommands = Readonly<{
  saveDraft: typeof saveActivityDraft;
  preparePublish: typeof preparePublishActivityIntent;
  decideIntent: typeof decideActionIntent;
  publishRelease: typeof publishActivityRelease;
}>;

const defaultCommands: ActivityAssistantCommands = {
  saveDraft: saveActivityDraft,
  preparePublish: preparePublishActivityIntent,
  decideIntent: decideActionIntent,
  publishRelease: publishActivityRelease,
};

export type ActivityAssistantToolDependencies = Readonly<{
  database: PrismaClient;
  agentContext: CommandContext;
  approvalContext: CommandContext;
  agentRunId: string;
  onToolFailure: (failureCode: string) => void;
  onBusinessWriteSuccess: (
    result: "DRAFT_SAVED" | "RELEASE_PUBLISHED",
  ) => void;
  commands?: ActivityAssistantCommands;
}>;

function idempotencyKey(kind: "draft" | "prepare" | "publish", callId: string) {
  const digest = createHash("sha256").update(callId).digest("hex");
  return `assistant_${kind}_${digest.slice(0, 40)}`;
}

function stableCommandFailure(error: unknown): string {
  if (
    error instanceof SaveActivityDraftError ||
    error instanceof PreparePublishActivityIntentError ||
    error instanceof DecideActionIntentError ||
    error instanceof PublishActivityReleaseError
  ) {
    return error.code;
  }
  return "COMMAND_FAILED";
}

export function createActivityAssistantTools({
  database,
  agentContext,
  approvalContext,
  agentRunId,
  onToolFailure,
  onBusinessWriteSuccess,
  commands = defaultCommands,
}: ActivityAssistantToolDependencies) {
  let createToolCallId: string | null = null;

  return {
    create_activity_draft: tool({
      description:
        "把教師已經說明清楚的完整跨學科任務書儲存成可預覽、可繼續編輯的活動草稿。必須包含基本設定、三維目標、三至四個連續階段、類型化證據及四檔量規，不能臆造缺失事實。",
      inputSchema: activityDraftProposalSchema,
      outputSchema: createdDraftToolOutputSchema,
      strict: true,
      execute: async (proposal, { toolCallId }) => {
        if (createToolCallId !== null && createToolCallId !== toolCallId) {
          onToolFailure("DRAFT_MULTIPLE_CREATE_ATTEMPTS");
          throw new Error("ACTIVITY_DRAFT_MULTIPLE_CREATE_ATTEMPTS");
        }
        createToolCallId = toolCallId;
        try {
          const result = await commands.saveDraft(database, agentContext, {
            draftId: null,
            expectedVersion: null,
            desiredStatus: "READY_FOR_PREVIEW",
            content: proposal.content,
            agentRunId,
            idempotencyKey: idempotencyKey("draft", toolCallId),
          });
          // A resolved command means the transaction and its provenance are
          // already durable. Mark that fact before response-only mapping so a
          // later serialization defect cannot rewrite the AgentRun as failed.
          onBusinessWriteSuccess("DRAFT_SAVED");
          const output = createdDraftToolOutputSchema.parse({
            draftId: result.draftId,
            version: result.version,
            status: result.status,
            editHref: `/teacher/activities/${result.draftId}`,
            previewHref: `/teacher/activities/${result.draftId}/preview`,
          });
          return output;
        } catch (error) {
          const code = stableCommandFailure(error);
          onToolFailure(`DRAFT_${code}`);
          throw new Error(`ACTIVITY_DRAFT_${code}`);
        }
      },
    }),

    publish_activity_release: tool({
      description:
        "發佈一個已處於可預覽狀態的活動草稿。此操作會先暫停並展示精確參數，只有目前教師明確批准後才會執行。",
      inputSchema: publishActivityToolInputSchema,
      outputSchema: publishActivityToolOutputSchema,
      strict: true,
      execute: async (input, { toolCallId }) => {
        try {
          // The AI SDK verifies the signed user approval before entering this
          // function. ActionIntent remains the business trust boundary: exact
          // parameters are prepared, decided by a trusted UI context, and only
          // then consumed by the publish command.
          const prepared = await commands.preparePublish(
            database,
            agentContext,
            {
              ...input,
              agentRunId,
              idempotencyKey: idempotencyKey("prepare", toolCallId),
            },
          );
          try {
            await commands.decideIntent(database, approvalContext, {
              actionIntentId: prepared.actionIntentId,
              decision: "CONFIRM",
            });
          } catch (error) {
            // Match the established first-party UI retry behavior. Only an
            // already-decided intent proceeds; publishActivityRelease then
            // proves it was CONFIRMED by this actor and still matches the
            // exact persisted parameters. Rejected/expired/foreign intents
            // therefore still fail closed.
            if (
              !(error instanceof DecideActionIntentError) ||
              error.code !== "ALREADY_DECIDED"
            ) {
              throw error;
            }
          }
          const release = await commands.publishRelease(
            database,
            agentContext,
            {
              actionIntentId: prepared.actionIntentId,
              idempotencyKey: idempotencyKey("publish", toolCallId),
            },
          );
          // The Release is immutable and committed when the shared command
          // resolves. Response mapping is not part of that business commit.
          onBusinessWriteSuccess("RELEASE_PUBLISHED");
          const output = publishActivityToolOutputSchema.parse({
            releaseId: release.releaseId,
            status: "PUBLISHED",
            publishedAt: release.publishedAt,
            releaseHref: `/teacher/releases/${release.releaseId}/submissions`,
          });
          return output;
        } catch (error) {
          const code = stableCommandFailure(error);
          onToolFailure(`PUBLISH_${code}`);
          throw new Error(`ACTIVITY_PUBLISH_${code}`);
        }
      },
    }),
  };
}

export type ActivityAssistantTools = ReturnType<
  typeof createActivityAssistantTools
>;
