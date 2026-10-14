import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../db/client";
import type { CommandContext } from "../commands/command-context";
import {
  getAssistantConversation,
  KEPT_ASSISTANT_CONVERSATIONS,
  listAssistantConversations,
  restoreWindowStart,
  saveAssistantConversation,
} from "./assistant-conversations";
import type { ActivityAssistantMessage } from "./activity-assistant-request";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

function contextFor(actorId: string): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => new Date() };
}

function conversation(text: string): ActivityAssistantMessage[] {
  return [
    { id: `user_${randomUUID().slice(0, 8)}`, role: "user", parts: [{ type: "text", text }] },
    { id: `assistant_${randomUUID().slice(0, 8)}`, role: "assistant", parts: [{ type: "text", text: "好的，我来看看。" }] },
  ];
}

async function createTeacher(name: string): Promise<string> {
  const id = randomUUID();
  await database!.appUser.create({
    data: { id, authSubject: `conversation_${id}`, role: "TEACHER", displayName: name },
  });
  return id;
}

describeWithDatabase("assistant conversations (D-099)", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("saves, lists and reopens a teacher's own conversation", async () => {
    const teacherId = await createTeacher("对话保存教师");
    const id = randomUUID();

    await expect(
      saveAssistantConversation(database!, contextFor(teacherId), {
        conversationId: id,
        messages: conversation("帮我看看校园节水行动的第二阶段，情境是不是和第一阶段接得上"),
      }),
    ).resolves.toBe("SAVED");
    const later = conversation("第二次保存");
    await saveAssistantConversation(database!, contextFor(teacherId), { conversationId: id, messages: later });

    expect(await listAssistantConversations(database!, contextFor(teacherId))).toEqual([
      expect.objectContaining({ id, title: "第二次保存" }),
    ]);
    const reopened = await getAssistantConversation(database!, contextFor(teacherId), { conversationId: id });
    expect(reopened?.messages).toEqual(later);
    expect(
      (await getAssistantConversation(database!, contextFor(teacherId), { latestSince: restoreWindowStart(new Date()) }))?.id,
    ).toBe(id);
  });

  it("never writes into or reveals another teacher's conversation", async () => {
    const owner = await createTeacher("对话所有者");
    const other = await createTeacher("另一位教师");
    const id = randomUUID();
    await saveAssistantConversation(database!, contextFor(owner), { conversationId: id, messages: conversation("我的对话") });

    await expect(
      saveAssistantConversation(database!, contextFor(other), { conversationId: id, messages: conversation("想覆盖") }),
    ).resolves.toBe("NOT_OWNER");
    expect(await getAssistantConversation(database!, contextFor(other), { conversationId: id })).toBeNull();
    expect(await listAssistantConversations(database!, contextFor(other))).toEqual([]);
    expect((await getAssistantConversation(database!, contextFor(owner), { conversationId: id }))?.messages[0]).toMatchObject({
      parts: [{ type: "text", text: "我的对话" }],
    });
  });

  it("keeps the most recent conversations only", async () => {
    const teacherId = await createTeacher("对话很多的教师");
    const ids: string[] = [];
    for (let index = 0; index < KEPT_ASSISTANT_CONVERSATIONS + 2; index += 1) {
      const id = randomUUID();
      ids.push(id);
      await saveAssistantConversation(database!, contextFor(teacherId), { conversationId: id, messages: conversation(`第 ${index} 段`) });
    }

    const kept = await listAssistantConversations(database!, contextFor(teacherId));
    expect(kept).toHaveLength(KEPT_ASSISTANT_CONVERSATIONS);
    expect(kept.map((item) => item.id)).not.toContain(ids[0]);
    expect(kept[0]!.id).toBe(ids.at(-1));
  });

  it("reopens a conversation in which the server refused a revision the teacher approved", async () => {
    const teacherId = await createTeacher("改写被退回的教师");
    const id = randomUUID();
    await database!.assistantConversation.create({
      data: {
        id,
        ownerId: teacherId,
        title: "改写被退回",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "改一下第二阶段" }] },
          {
            id: "a1",
            role: "assistant",
            parts: [
              {
                // How AI SDK leaves a call the teacher approved and a gate
                // then refused: denied, yet still marked approved.
                type: "tool-update_activity_draft",
                toolCallId: "refused_revise",
                state: "output-denied",
                input: {
                  draftId: randomUUID(),
                  expectedVersion: 1,
                  summary: "改写第二阶段情境。",
                  edits: [{ op: "set", path: "phases[1].context", value: "承接上一阶段。" }],
                },
                approval: { id: "approval_1", signature: "s".repeat(64), approved: true },
              },
              { type: "text", text: "草稿未改动。", state: "done" },
            ],
          },
        ],
      },
    });

    const reopened = await getAssistantConversation(database!, contextFor(teacherId), { conversationId: id });
    expect(reopened?.messages[1]?.parts[0]).toMatchObject({
      state: "output-denied",
      approval: { approved: false },
    });
  });

  it("does not reopen a conversation whose saved tool calls no longer validate", async () => {
    const teacherId = await createTeacher("旧对话教师");
    const id = randomUUID();
    await database!.assistantConversation.create({
      data: {
        id,
        ownerId: teacherId,
        title: "旧版改写",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "改一下" }] },
          {
            id: "a1",
            role: "assistant",
            parts: [
              {
                type: "tool-update_activity_draft",
                toolCallId: "old_revise",
                state: "input-available",
                input: { draftId: randomUUID(), expectedVersion: 1, changes: [], content: {} },
              },
            ],
          },
        ],
      },
    });

    expect(await getAssistantConversation(database!, contextFor(teacherId), { conversationId: id })).toBeNull();
  });
});
