import "server-only";

import {
  type InferUITools,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { z } from "zod";
import { activityAssistantMessageValidationTools } from "./activity-assistant-tools";

export const ACTIVITY_ASSISTANT_MAX_REQUEST_BYTES = 64 * 1024;
const MAX_MESSAGES = 16;
const MAX_USER_TEXT = 4_000;
const MAX_HISTORY_TEXT = 20_000;
const MAX_TOOL_PARTS = 24;

const requestBodySchema = z
  .object({
    messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
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
        part.type === "tool-publish_activity_release" &&
        (part.state === "approval-requested" ||
          part.state === "approval-responded" ||
          part.state === "output-available" ||
          part.state === "output-error" ||
          part.state === "output-denied")
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
      part.type === "tool-publish_activity_release" &&
      part.state === "approval-responded" &&
      part.approval.isAutomatic !== true,
  );
  if (!hasApprovalResponse) {
    throw new ActivityAssistantRequestError("INVALID_MESSAGES");
  }
}

export async function parseActivityAssistantRequest(
  request: Request,
): Promise<ActivityAssistantMessage[]> {
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
  return messages;
}
