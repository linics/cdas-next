import "server-only";

import { randomUUID } from "node:crypto";
import { validateUIMessages } from "ai";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { type CommandContext, resolveCommandContext } from "../commands/command-context";
import { activityAssistantMessageValidationTools } from "./activity-assistant-tools";
import {
  type ActivityAssistantMessage,
  settleServerDeniedApprovals,
} from "./activity-assistant-request";

/** How many conversations a teacher keeps; older ones are removed on save. */
export const KEPT_ASSISTANT_CONVERSATIONS = 30;
/** A conversation older than this is not reopened by itself on a new page load. */
const RESTORE_WITHIN_DAYS = 14;
const TITLE_LENGTH = 40;

export type AssistantConversationSummary = Readonly<{
  id: string;
  title: string;
  updatedAt: string;
}>;

export type RestoredAssistantConversation = Readonly<{
  id: string;
  title: string;
  updatedAt: string;
  messages: ActivityAssistantMessage[];
}>;

const conversationIdSchema = z.uuid();
const messageIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;

function titleOf(messages: readonly ActivityAssistantMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const text = first?.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return "";
  const chars = Array.from(text);
  return chars.length > TITLE_LENGTH ? `${chars.slice(0, TITLE_LENGTH).join("")}…` : text;
}

/**
 * D-099: store the conversation as the reply left it. A conversation id
 * belongs to the teacher who first saved it; a save aimed at someone else's
 * id is dropped rather than overwriting their history.
 */
export async function saveAssistantConversation(
  database: PrismaClient,
  commandContext: CommandContext,
  input: Readonly<{ conversationId: string; messages: readonly ActivityAssistantMessage[] }>,
): Promise<"SAVED" | "NOT_OWNER"> {
  const context = resolveCommandContext(commandContext, ["UI", "AGENT"]);
  const id = conversationIdSchema.parse(input.conversationId);
  // Every message needs an id the next request will accept; a reply that
  // somehow arrived without one gets it here rather than poisoning history.
  const messages = input.messages.map((message) =>
    messageIdPattern.test(message.id) ? message : { ...message, id: `restored_${randomUUID().replaceAll("-", "")}` },
  ) as unknown as Prisma.InputJsonValue;
  const title = titleOf(input.messages);

  const updated = await database.assistantConversation.updateMany({
    where: { id, ownerId: context.actorId },
    data: { messages, title },
  });
  if (updated.count === 0) {
    try {
      await database.assistantConversation.create({
        data: { id, ownerId: context.actorId, messages, title },
      });
    } catch (error) {
      // The id exists and is someone else's, or a concurrent first save won.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const retried = await database.assistantConversation.updateMany({
          where: { id, ownerId: context.actorId },
          data: { messages, title },
        });
        if (retried.count === 0) return "NOT_OWNER";
      } else {
        throw error;
      }
    }
  }

  const kept = await database.assistantConversation.findMany({
    where: { ownerId: context.actorId },
    orderBy: { updatedAt: "desc" },
    take: KEPT_ASSISTANT_CONVERSATIONS,
    select: { id: true },
  });
  await database.assistantConversation.deleteMany({
    where: { ownerId: context.actorId, id: { notIn: kept.map((row) => row.id) } },
  });
  return "SAVED";
}

export async function listAssistantConversations(
  database: PrismaClient,
  commandContext: CommandContext,
): Promise<AssistantConversationSummary[]> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const rows = await database.assistantConversation.findMany({
    where: { ownerId: context.actorId },
    orderBy: { updatedAt: "desc" },
    take: KEPT_ASSISTANT_CONVERSATIONS,
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() }));
}

/**
 * A stored conversation the panel can carry on with, or null. Conversations
 * saved before a tool changed shape no longer validate and are not reopened:
 * the next request would refuse them anyway.
 */
export async function getAssistantConversation(
  database: PrismaClient,
  commandContext: CommandContext,
  input: Readonly<{ conversationId: string } | { latestSince: Date }>,
): Promise<RestoredAssistantConversation | null> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const row =
    "conversationId" in input
      ? conversationIdSchema.safeParse(input.conversationId).success
        ? await database.assistantConversation.findFirst({
            where: { id: input.conversationId, ownerId: context.actorId },
          })
        : null
      : await database.assistantConversation.findFirst({
          where: { ownerId: context.actorId, updatedAt: { gte: input.latestSince } },
          orderBy: { updatedAt: "desc" },
        });
  if (!row) return null;
  try {
    const messages = await validateUIMessages<ActivityAssistantMessage>({
      messages: settleServerDeniedApprovals(row.messages as unknown[]),
      tools: activityAssistantMessageValidationTools,
    });
    if (messages.some((message) => !messageIdPattern.test(message.id))) return null;
    return { id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString(), messages };
  } catch {
    return null;
  }
}

export function restoreWindowStart(now: Date): Date {
  return new Date(now.getTime() - RESTORE_WITHIN_DAYS * 24 * 60 * 60 * 1000);
}
