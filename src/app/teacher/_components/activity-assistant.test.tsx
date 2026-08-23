import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useChat: vi.fn(),
  push: vi.fn(),
  sendMessage: vi.fn(),
  stop: vi.fn(),
  addToolApprovalResponse: vi.fn(),
  capturedOptions: null as null | {
    onFinish?: (options: { message: { parts: unknown[] } }) => void;
  },
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: unknown) => {
    mocks.capturedOptions = options as typeof mocks.capturedOptions;
    return mocks.useChat();
  },
}));
vi.mock("ai", () => ({
  DefaultChatTransport: class DefaultChatTransport {
    constructor() {}
  },
  lastAssistantMessageIsCompleteWithApprovalResponses: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import {
  ActivityAssistant,
  ActivityAssistantSessionProvider,
} from "./activity-assistant";

const draftId = "10000000-0000-4000-8000-000000000001";
const classroomId = "20000000-0000-4000-8000-000000000002";

function helpers(messages: unknown[] = []) {
  return {
    messages,
    sendMessage: mocks.sendMessage,
    status: "ready",
    error: undefined,
    stop: mocks.stop,
    addToolApprovalResponse: mocks.addToolApprovalResponse,
  };
}

function renderAssistant(
  classrooms: Array<{ id: string; name: string }> = [],
  continuationOnly = false,
) {
  return renderToStaticMarkup(
    <ActivityAssistantSessionProvider>
      <ActivityAssistant
        classrooms={classrooms}
        continuationOnly={continuationOnly}
      />
    </ActivityAssistantSessionProvider>,
  );
}

describe("ActivityAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capturedOptions = null;
    mocks.useChat.mockReturnValue(helpers());
  });

  it("states the manual safety boundary and keeps a bounded prompt", () => {
    const markup = renderAssistant();

    expect(markup).toContain("把活动构想整理成可编辑草稿");
    expect(markup).toContain("没有你的明确确认就不会发布");
    expect(markup).toContain('maxLength="4000"');
    expect(markup).toContain("手动创建与编辑活动仍可正常使用");
    expect(markup).not.toContain("AI_TOOL_APPROVAL_SECRET");
  });

  it("renders exact draft edit and preview destinations", () => {
    mocks.useChat.mockReturnValue(
      helpers([
        {
          id: "assistant_1",
          role: "assistant",
          parts: [
            {
              type: "tool-create_activity_draft",
              toolCallId: "draft_call_1",
              state: "output-available",
              input: {},
              output: {
                draftId,
                version: 1,
                status: "READY_FOR_PREVIEW",
                editHref: `/teacher/activities/${draftId}`,
                previewHref: `/teacher/activities/${draftId}/preview`,
              },
            },
          ],
        },
      ]),
    );

    const markup = renderAssistant();

    expect(markup).toContain(
      `href="/teacher/activities/${draftId}/preview"`,
    );
    expect(markup).toContain(`href="/teacher/activities/${draftId}"`);
  });

  it("shows native approval controls with exact human-readable parameters", () => {
    mocks.useChat.mockReturnValue(
      helpers([
        {
          id: "assistant_approval",
          role: "assistant",
          parts: [
            {
              type: "tool-publish_activity_release",
              toolCallId: "publish_call_1",
              state: "approval-requested",
              input: {
                draftId,
                expectedDraftVersion: 3,
                classroomId,
                dueAt: null,
              },
              approval: {
                id: "approval_1",
                signature: "signed-but-never-rendered",
                isAutomatic: false,
              },
            },
          ],
        },
      ]),
    );

    const markup = renderAssistant([
      { id: classroomId, name: "七年一班" },
    ]);

    expect(markup).toContain("确认发布这个精确版本");
    expect(markup).toContain("版本 3");
    expect(markup).toContain("七年一班");
    expect(markup).toContain("确认并发布");
    expect(markup).toContain("取消");
    expect(markup).not.toContain("signed-but-never-rendered");
    expect(markup).not.toContain("approval_1");
  });

  it("navigates only when the server output matches the exact tool input", () => {
    renderAssistant();
    const onFinish = mocks.capturedOptions?.onFinish;
    expect(onFinish).toBeTypeOf("function");

    onFinish?.({
      message: {
        parts: [
          {
            type: "tool-create_activity_draft",
            toolCallId: "open_exact_1",
            state: "output-available",
            input: {},
            output: {
              draftId,
              version: 1,
              status: "READY_FOR_PREVIEW",
              editHref: `/teacher/activities/${draftId}`,
              previewHref: `/teacher/activities/${draftId}/preview`,
            },
          },
        ],
      },
    });
    onFinish?.({
      message: {
        parts: [
          {
            type: "tool-create_activity_draft",
            toolCallId: "open_tampered_2",
            state: "output-available",
            input: {},
            output: {
              draftId,
              version: 1,
              status: "READY_FOR_PREVIEW",
              editHref: `/teacher/activities/${draftId}`,
              previewHref: `/teacher/activities/${draftId}`,
            },
          },
        ],
      },
    });

    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith(
      `/teacher/activities/${draftId}/preview`,
    );
  });

  it("does not render a continuation surface for a fresh direct preview", () => {
    expect(renderAssistant([], true)).toBe("");
  });

  it("renders retained messages and approval controls in continuation mode", () => {
    mocks.useChat.mockReturnValue(
      helpers([
        {
          id: "assistant_continuation",
          role: "assistant",
          parts: [
            {
              type: "tool-publish_activity_release",
              toolCallId: "publish_continuation",
              state: "approval-requested",
              input: {
                draftId,
                expectedDraftVersion: 3,
                classroomId,
                dueAt: null,
              },
              approval: {
                id: "approval_continuation",
                isAutomatic: false,
              },
            },
          ],
        },
      ]),
    );

    const markup = renderAssistant(
      [{ id: classroomId, name: "七年一班" }],
      true,
    );
    expect(markup).toContain("继续核对活动并准备发布");
    expect(markup).toContain("确认发布这个精确版本");
    expect(markup).toContain("七年一班");
  });
});
