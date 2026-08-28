import "server-only";

import {
  type InferUITools,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { z } from "zod";
import {
  teacherAgentPageContextSchema,
  type TeacherAgentPageContext,
} from "../../domain/assistant/teacher-agent-page-context";
import {
  activityAssistantMessageValidationTools,
  activityDraftProposalSchema,
  mapCurrentTeacherContext,
  mapTeacherClassroomList,
  mapTeacherDraftList,
  mapTeacherReleaseList,
} from "./activity-assistant-tools";
import type { TeacherActivityDashboard } from "../queries/teacher-activity-workspace";
import type { TeacherDraftDetailReader } from "./teacher-draft-detail";
import {
  officialKnowledgeSectionKey,
  readOfficialKnowledgeSection,
  searchOfficialKnowledge,
  type OfficialKnowledgeSectionIdentity,
} from "../knowledge/official-corpus";

export const ACTIVITY_ASSISTANT_MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MESSAGES = 16;
const MAX_USER_TEXT = 4_000;
const MAX_HISTORY_TEXT = 20_000;
const MAX_TOOL_PARTS = 24;

const requestBodySchema = z
  .object({
    messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
    pageContext: teacherAgentPageContextSchema.optional(),
  })
  .strict();

export type ActivityAssistantMessage = UIMessage<
  undefined,
  never,
  InferUITools<typeof activityAssistantMessageValidationTools>
>;

export class ActivityAssistantRequestError extends Error {
  constructor(
    public readonly code:
      | "REQUEST_TOO_LARGE"
      | "INVALID_JSON"
      | "INVALID_MESSAGES",
  ) {
    super(code);
    this.name = "ActivityAssistantRequestError";
  }
}

function assertSafeMessageHistory(
  messages: ActivityAssistantMessage[],
): void {
  const messageIds = new Set<string>();
  const toolCallIds = new Set<string>();
  let historyTextLength = 0;
  let toolPartCount = 0;
  const searchedSectionKeys = new Set<string>();
  const readSectionKeys = new Set<string>();

  for (const [messageIndex, message] of messages.entries()) {
    if (
      message.id.length < 1 ||
      message.id.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(message.id) ||
      messageIds.has(message.id) ||
      message.metadata !== undefined ||
      message.role === "system"
    ) {
      throw new ActivityAssistantRequestError("INVALID_MESSAGES");
    }
    messageIds.add(message.id);

    const expectedRole = messageIndex % 2 === 0 ? "user" : "assistant";
    if (message.role !== expectedRole || message.parts.length === 0) {
      throw new ActivityAssistantRequestError("INVALID_MESSAGES");
    }

    for (const part of message.parts) {
      if (part.type === "text") {
        if (
          part.providerMetadata !== undefined ||
          part.text.length >
            (message.role === "user" ? MAX_USER_TEXT : 8_000)
        ) {
          throw new ActivityAssistantRequestError("INVALID_MESSAGES");
        }
        historyTextLength += part.text.length;
        continue;
      }

      if (message.role !== "assistant" || part.type === "step-start") {
        if (message.role === "assistant" && part.type === "step-start") {
          continue;
        }
        throw new ActivityAssistantRequestError("INVALID_MESSAGES");
      }

      if (
        part.type !== "tool-get_current_context" &&
        part.type !== "tool-list_my_classrooms" &&
        part.type !== "tool-list_my_activity_drafts" &&
        part.type !== "tool-list_my_releases" &&
        part.type !== "tool-get_activity_draft" &&
        part.type !== "tool-search_knowledge" &&
        part.type !== "tool-read_source_section" &&
        part.type !== "tool-create_activity_draft" &&
        part.type !== "tool-publish_activity_release"
      ) {
        throw new ActivityAssistantRequestError("INVALID_MESSAGES");
      }

      toolPartCount += 1;
      if (
        toolPartCount > MAX_TOOL_PARTS ||
        part.toolCallId.length < 1 ||
        part.toolCallId.length > 128 ||
        !/^[A-Za-z0-9_-]+$/.test(part.toolCallId) ||
        toolCallIds.has(part.toolCallId) ||
        part.providerExecuted === true ||
        part.callProviderMetadata !== undefined ||
        part.toolMetadata !== undefined
      ) {
        throw new ActivityAssistantRequestError("INVALID_MESSAGES");
      }
      toolCallIds.add(part.toolCallId);

      if (
        (part.type === "tool-get_current_context" ||
          part.type === "tool-list_my_classrooms" ||
          part.type === "tool-list_my_activity_drafts" ||
          part.type === "tool-list_my_releases" ||
          part.type === "tool-get_activity_draft") &&
        part.state !== "output-available"
      ) {
        throw new ActivityAssistantRequestError("INVALID_MESSAGES");
      }

      if (part.type === "tool-search_knowledge") {
        if (part.state !== "output-available") {
          throw new ActivityAssistantRequestError("INVALID_MESSAGES");
        }
        const canonicalOutput = searchOfficialKnowledge(part.input);
        if (JSON.stringify(part.output) !== JSON.stringify(canonicalOutput)) {
          throw new ActivityAssistantRequestError("INVALID_MESSAGES");
        }
        canonicalOutput.results.forEach((result) => {
          searchedSectionKeys.add(officialKnowledgeSectionKey(result));
        });
      }

      if (part.type === "tool-read_source_section") {
        if (part.state !== "output-available") {
          throw new ActivityAssistantRequestError("INVALID_MESSAGES");
        }
        const key = officialKnowledgeSectionKey(part.input);
        const canonicalOutput = readOfficialKnowledgeSection(part.input);
        if (
          !searchedSectionKeys.has(key) ||
          JSON.stringify(part.output) !==
            JSON.stringify(canonicalOutput)
        ) {
          throw new ActivityAssistantRequestError("INVALID_MESSAGES");
        }
        if (canonicalOutput.status === "FOUND") {
          readSectionKeys.add(key);
        }
      }

      if (part.type === "tool-create_activity_draft") {
        const proposal = activityDraftProposalSchema.safeParse(part.input);
        if (
          !proposal.success ||
          proposal.data.sourceReferences.some(
            (reference) =>
              !readSectionKeys.has(officialKnowledgeSectionKey(reference)),
          )
        ) {
          throw new ActivityAssistantRequestError("INVALID_MESSAGES");
        }
      }

      if (
        (part.type === "tool-create_activity_draft" ||
          part.type === "tool-publish_activity_release") &&
        (part.state === "approval-requested" ||
          part.state === "approval-responded")
      ) {
        const signature = part.approval?.signature;
        if (!signature || signature.length > 1_024) {
          throw new ActivityAssistantRequestError("INVALID_MESSAGES");
        }
      }
    }
  }

  if (historyTextLength > MAX_HISTORY_TEXT) {
    throw new ActivityAssistantRequestError("INVALID_MESSAGES");
  }

  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new ActivityAssistantRequestError("INVALID_MESSAGES");
  }
  if (lastMessage.role === "user") {
    const userText = lastMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
    if (!userText) {
      throw new ActivityAssistantRequestError("INVALID_MESSAGES");
    }
    return;
  }

  const hasApprovalResponse = lastMessage.parts.some(
    (part) =>
      (part.type === "tool-create_activity_draft" ||
        part.type === "tool-publish_activity_release") &&
      part.state === "approval-responded" &&
      part.approval.isAutomatic !== true,
  );
  if (!hasApprovalResponse) {
    throw new ActivityAssistantRequestError("INVALID_MESSAGES");
  }
}

export function getActivityAssistantKnowledgeLedger(
  messages: ActivityAssistantMessage[],
): Readonly<{
  searchResults: OfficialKnowledgeSectionIdentity[];
  readSections: OfficialKnowledgeSectionIdentity[];
}> {
  const searchResults = new Map<string, OfficialKnowledgeSectionIdentity>();
  const readSections = new Map<string, OfficialKnowledgeSectionIdentity>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (
        part.type === "tool-search_knowledge" &&
        part.state === "output-available"
      ) {
        part.output.results.forEach((result) => {
          searchResults.set(officialKnowledgeSectionKey(result), result);
        });
      }
      if (
        part.type === "tool-read_source_section" &&
        part.state === "output-available" &&
        part.output.status === "FOUND"
      ) {
        readSections.set(officialKnowledgeSectionKey(part.output), part.output);
      }
    }
  }
  return {
    searchResults: [...searchResults.values()],
    readSections: [...readSections.values()],
  };
}

export type ParsedActivityAssistantRequest = Readonly<{
  messages: ActivityAssistantMessage[];
  pageContext: TeacherAgentPageContext;
}>;

/**
 * Client-supplied history is never trusted as a record of what the teacher is
 * allowed to see. Every read-only result is recomputed from the current
 * authorized workspace before it reaches the model, so a draft that was
 * renamed, rewritten, deleted, or handed to another teacher between turns
 * cannot survive in the conversation as its stale self.
 */
export async function canonicalizeActivityAssistantReadOnlyHistory(
  messages: ActivityAssistantMessage[],
  workspace: TeacherActivityDashboard,
  pageContext: TeacherAgentPageContext,
  readDraftDetail: TeacherDraftDetailReader,
): Promise<ActivityAssistantMessage[]> {
  return Promise.all(messages.map(async (message) => {
    if (message.role !== "assistant") return message;
    const parts = await Promise.all(message.parts.map(async (part) => {
      if (
        part.type === "tool-get_activity_draft" &&
        part.state === "output-available"
      ) {
        return { ...part, output: await readDraftDetail(part.input.draftId) };
      }
      return part;
    }));
    return {
      ...message,
      parts: parts.map((part) => {
        if (
          part.type === "tool-get_current_context" &&
          part.state === "output-available"
        ) {
          return {
            ...part,
            output: mapCurrentTeacherContext(pageContext, workspace),
          };
        }
        if (
          part.type === "tool-list_my_classrooms" &&
          part.state === "output-available"
        ) {
          return { ...part, output: mapTeacherClassroomList(workspace) };
        }
        if (
          part.type === "tool-list_my_activity_drafts" &&
          part.state === "output-available"
        ) {
          return { ...part, output: mapTeacherDraftList(workspace) };
        }
        if (
          part.type === "tool-list_my_releases" &&
          part.state === "output-available"
        ) {
          return { ...part, output: mapTeacherReleaseList(workspace) };
        }
        return part;
      }),
    };
  }));
}

export async function parseActivityAssistantRequestEnvelope(
  request: Request,
): Promise<ParsedActivityAssistantRequest> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > ACTIVITY_ASSISTANT_MAX_REQUEST_BYTES
  ) {
    throw new ActivityAssistantRequestError("REQUEST_TOO_LARGE");
  }

  const text = await request.text();
  if (
    new TextEncoder().encode(text).byteLength >
    ACTIVITY_ASSISTANT_MAX_REQUEST_BYTES
  ) {
    throw new ActivityAssistantRequestError("REQUEST_TOO_LARGE");
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(text);
  } catch {
    throw new ActivityAssistantRequestError("INVALID_JSON");
  }

  const body = requestBodySchema.safeParse(rawBody);
  if (!body.success) {
    throw new ActivityAssistantRequestError("INVALID_MESSAGES");
  }

  let messages: ActivityAssistantMessage[];
  try {
    messages = await validateUIMessages<ActivityAssistantMessage>({
      messages: body.data.messages,
      tools: activityAssistantMessageValidationTools,
    });
  } catch {
    throw new ActivityAssistantRequestError("INVALID_MESSAGES");
  }
  assertSafeMessageHistory(messages);
  return {
    messages,
    pageContext: body.data.pageContext ?? {
      kind: "UNKNOWN_TEACHER_PAGE",
    },
  };
}

export async function parseActivityAssistantRequest(
  request: Request,
): Promise<ActivityAssistantMessage[]> {
  return (await parseActivityAssistantRequestEnvelope(request)).messages;
}
