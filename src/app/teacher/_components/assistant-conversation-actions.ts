"use server";

import {
  getAssistantConversation,
  listAssistantConversations,
  type AssistantConversationSummary,
  type RestoredAssistantConversation,
} from "../../../server/assistant/assistant-conversations";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";

/** D-099: the teacher's own recent conversations, newest first. */
export async function listAssistantConversationsAction(): Promise<AssistantConversationSummary[]> {
  try {
    return await listAssistantConversations(getDatabaseClient(), await createUiCommandContext());
  } catch {
    return [];
  }
}

/** One of the teacher's own conversations, or null when it cannot be carried on. */
export async function openAssistantConversationAction(
  conversationId: string,
): Promise<RestoredAssistantConversation | null> {
  try {
    return await getAssistantConversation(getDatabaseClient(), await createUiCommandContext(), {
      conversationId,
    });
  } catch {
    return null;
  }
}
