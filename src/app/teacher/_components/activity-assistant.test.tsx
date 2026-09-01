import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waterConservationTaskBookV3 } from "../../../fixtures/water-conservation-v3";

const mocks = vi.hoisted(() => ({
  useChat: vi.fn(),
  sendMessage: vi.fn(),
  stop: vi.fn(),
  addToolApprovalResponse: vi.fn(),
  pathname: "/teacher",
  transportOptions: [] as unknown[],
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => mocks.useChat(),
}));
vi.mock("ai", () => ({
  DefaultChatTransport: class DefaultChatTransport {
    constructor(options: unknown) {
      mocks.transportOptions.push(options);
    }
  },
  lastAssistantMessageIsCompleteWithApprovalResponses: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
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
  isComposerSubmitKey,
  isFollowingTranscriptBottom,
} from "./activity-assistant";

const draftId = "10000000-0000-4000-8000-000000000001";
const classroomId = "20000000-0000-4000-8000-000000000002";
const draftProposal = {
  taskUnderstandingSummary: {
    realWorldContext: "校园需要改善用水。",
    studentAction: "记录并比较水表读数。",
    intendedOutcome: "提出节水建议。",
    evidenceAndAssessment: "以记录、分析和建议评价。",
  },
  teacherRequirements: ["七年级", "校园节水"],
  assumptions: [],
  sourceReferences: [
    {
      sourceId: "course-plan-2022",
      sectionId: "course-plan-2022-section",
      citationLabel: "《义务教育课程方案（2022年版）》· 基本原则",
      href: "/teacher/knowledge?source=course-plan-2022&section=course-plan-2022-section",
      reason: "用于校准跨学科任务的真实情境与实践要求。",
    },
  ],
  content: waterConservationTaskBookV3,
};

function helpers(
  messages: unknown[] = [],
  status: "ready" | "submitted" | "streaming" = "ready",
) {
  return {
    messages,
    sendMessage: mocks.sendMessage,
    status,
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
    mocks.pathname = "/teacher";
    mocks.transportOptions.length = 0;
    mocks.useChat.mockReturnValue(helpers());
  });

  it("states the manual safety boundary and keeps a bounded prompt", () => {
    const markup = renderAssistant();

    expect(markup).toContain("把活动构想整理成可编辑草稿");
    expect(markup).toContain("没有你的明确确认就不会发布");
    expect(markup).toContain('maxLength="4000"');
    expect(markup).toContain('data-hydrated="false"');
    expect(markup).toMatch(
      /<textarea[^>]*id="activity-assistant-prompt"[^>]*disabled=""/u,
    );
    expect(markup).toContain("手动创建与编辑活动仍可正常使用");
    expect(markup).not.toContain("AI_TOOL_APPROVAL_SECRET");
  });

  it("renders the bounded global-panel responsibility copy", () => {
    const markup = renderToStaticMarkup(
      <ActivityAssistantSessionProvider>
        <ActivityAssistant classrooms={[]} surface="panel" />
      </ActivityAssistantSessionProvider>,
    );

    expect(markup).toContain('data-surface="panel"');
    expect(markup).toContain("教师工作台与活动设计");
    expect(markup).toContain("可分配职责");
    expect(markup).toContain("所有站内跳转都由你点击");
    expect(markup).not.toContain("当前职责");
  });

  it("uses a compact stop control next to submit while the model is streaming", () => {
    mocks.useChat.mockReturnValue(helpers([], "streaming"));
    const markup = renderAssistant();

    expect(markup).toContain('aria-label="停止生成"');
    expect(markup).not.toContain(">停止<");
    expect(markup).toContain("交给助手整理");
  });

  it("sends on Enter and inserts a line on Shift+Enter", () => {
    expect(
      isComposerSubmitKey({ key: "Enter", shiftKey: false, nativeEvent: {} }),
    ).toBe(true);
    expect(
      isComposerSubmitKey({ key: "Enter", shiftKey: true, nativeEvent: {} }),
    ).toBe(false);
    expect(
      isComposerSubmitKey({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
      }),
    ).toBe(false);
    expect(
      isComposerSubmitKey({ key: "a", shiftKey: false, nativeEvent: {} }),
    ).toBe(false);
  });

  it("sends only an allowlisted current page context with each request", () => {
    mocks.pathname = `/teacher/activities/${draftId}/preview`;
    renderAssistant();
    const options = mocks.transportOptions.at(-1) as {
      prepareSendMessagesRequest: (input: { messages: unknown[] }) => {
        body: unknown;
      };
    };

    expect(
      options.prepareSendMessagesRequest({ messages: [{ id: "message_1" }] }),
    ).toEqual({
      body: {
        messages: [{ id: "message_1" }],
        pageContext: { kind: "ACTIVITY_PREVIEW", resourceId: draftId },
      },
    });
  });

  it("renders read-only workspace results as exact user-clicked links", () => {
    mocks.useChat.mockReturnValue(
      helpers([
        {
          id: "assistant_workspace",
          role: "assistant",
          parts: [
            {
              type: "tool-get_current_context",
              toolCallId: "context_1",
              state: "output-available",
              input: {},
              output: {
                status: "AVAILABLE",
                kind: "TEACHER_DASHBOARD",
                label: "教师工作台",
                href: "/teacher",
              },
            },
            {
              type: "tool-list_my_classrooms",
              toolCallId: "classrooms_1",
              state: "output-available",
              input: {},
              output: {
                classrooms: [
                  {
                    id: classroomId,
                    name: "七年一班",
                    currentMemberCount: 28,
                    href: `/teacher/classrooms/${classroomId}/members`,
                  },
                ],
              },
            },
            {
              type: "tool-list_my_activity_drafts",
              toolCallId: "drafts_1",
              state: "output-available",
              input: {},
              output: {
                drafts: [
                  {
                    id: draftId,
                    title: "校园节水行动",
                    status: "READY_FOR_PREVIEW",
                    version: 3,
                    updatedAt: "2026-08-28T08:00:00.000Z",
                    editHref: `/teacher/activities/${draftId}`,
                    previewHref: `/teacher/activities/${draftId}/preview`,
                  },
                ],
              },
            },
          ],
        },
      ]),
    );

    const markup = renderAssistant();
    expect(markup).toContain('href="/teacher"');
    expect(markup).toContain(
      `href="/teacher/classrooms/${classroomId}/members"`,
    );
    expect(markup).toContain(`href="/teacher/activities/${draftId}"`);
    expect(markup).toContain(
      `href="/teacher/activities/${draftId}/preview"`,
    );
    expect(markup).not.toContain("router.push");
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

  it("shows the structured draft proposal before creation and never renders approval secrets", () => {
    mocks.useChat.mockReturnValue(
      helpers([
        {
          id: "assistant_draft_approval",
          role: "assistant",
          parts: [
            {
              type: "tool-create_activity_draft",
              toolCallId: "draft_proposal_1",
              state: "approval-requested",
              input: draftProposal,
              approval: {
                id: "draft_approval_1",
                signature: "draft-signed-but-never-rendered",
                isAutomatic: false,
              },
            },
          ],
        },
      ]),
    );

    const markup = renderAssistant();

    expect(markup).toContain("先确认这份可编辑的任务理解");
    expect(markup).toContain("教师已提供要求");
    expect(markup).toContain("明确假设");
    expect(markup).toContain("跨学科必要性");
    expect(markup).toContain("目标—任务—证据—评价一致性链");
    expect(markup).toContain("本次设计参考了哪些依据");
    expect(markup).toContain("用于校准跨学科任务的真实情境与实践要求");
    expect(markup).toContain("不代表活动已自动通过课程标准合规审查");
    expect(markup).toContain("确认理解并创建草稿");
    expect(markup).toContain("继续补充");
    expect(markup).not.toContain("draft-signed-but-never-rendered");
    expect(markup).not.toContain("draft_approval_1");
  });

  it("keeps the draft-progress copy only while the stream is still open", () => {
    mocks.useChat.mockReturnValue(
      helpers(
        [
          {
            id: "assistant_draft_streaming",
            role: "assistant",
            parts: [
              {
                type: "tool-create_activity_draft",
                toolCallId: "draft_streaming_1",
                state: "input-streaming",
              },
            ],
          },
        ],
        "streaming",
      ),
    );

    expect(renderAssistant()).toContain("正在整理任务理解与设计建议…");
  });

  it("shows a terminal draft failure after the stream ends without a proposal", () => {
    mocks.useChat.mockReturnValue(
      helpers([
        {
          id: "assistant_draft_incomplete",
          role: "assistant",
          parts: [
            {
              type: "tool-create_activity_draft",
              toolCallId: "draft_incomplete_1",
              state: "input-streaming",
            },
          ],
        },
      ]),
    );

    const markup = renderAssistant();
    expect(markup).toContain(
      "草稿未创建。你可以补一句&quot;请重新创建草稿&quot;让助手重试，或改用手动表单。",
    );
    expect(markup).not.toContain("正在整理任务理解与设计建议…");
  });

  it("shows the same terminal copy when draft input validation fails without parsed input", () => {
    mocks.useChat.mockReturnValue(
      helpers([
        {
          id: "assistant_draft_input_error",
          role: "assistant",
          parts: [
            {
              type: "tool-create_activity_draft",
              toolCallId: "draft_input_error_1",
              state: "output-error",
              errorText: "Invalid input for tool create_activity_draft",
            },
          ],
        },
      ]),
    );

    const markup = renderAssistant();
    expect(markup).toContain(
      "草稿未创建。你可以补一句&quot;请重新创建草稿&quot;让助手重试，或改用手动表单。",
    );
    expect(markup).not.toContain("正在整理任务理解与设计建议…");
  });

  it("renders official search and source-reading results as inspectable citations", () => {
    const href =
      "/teacher/knowledge?source=math-standard-2022&section=math-standard-2022-section";
    mocks.useChat.mockReturnValue(
      helpers([
        {
          id: "assistant_knowledge",
          role: "assistant",
          parts: [
            {
              type: "tool-search_knowledge",
              toolCallId: "search_knowledge_1",
              state: "output-available",
              input: { query: "数据分析 评价" },
              output: {
                status: "FOUND",
                results: [
                  {
                    sourceId: "math-standard-2022",
                    sectionId: "math-standard-2022-section",
                    sourceTitle: "义务教育数学课程标准（2022年版）",
                    locator: "五、学业质量",
                    citationLabel:
                      "《义务教育数学课程标准（2022年版）》· 五、学业质量",
                    excerpt: "能够进行简单的数据分析，形成数据观念。",
                    href,
                    sourceUrl: "https://www.moe.gov.cn/source",
                  },
                ],
              },
            },
            {
              type: "tool-read_source_section",
              toolCallId: "read_knowledge_1",
              state: "output-available",
              input: {
                sourceId: "math-standard-2022",
                sectionId: "math-standard-2022-section",
              },
              output: {
                status: "FOUND",
                sourceId: "math-standard-2022",
                sectionId: "math-standard-2022-section",
                sourceTitle: "义务教育数学课程标准（2022年版）",
                publisher: "中华人民共和国教育部",
                version: "2022年版",
                locator: "五、学业质量",
                citationLabel:
                  "《义务教育数学课程标准（2022年版）》· 五、学业质量",
                content: "能够进行简单的数据分析，形成数据观念。",
                href,
                sourceUrl: "https://www.moe.gov.cn/source",
              },
            },
          ],
        },
      ]),
    );

    const markup = renderAssistant();

    expect(markup).toContain("已找到 1 个官方标准片段");
    expect(markup).toContain("能够进行简单的数据分析");
    expect(markup).toContain("已读取：");
    expect(markup).toContain(`href="${href.replaceAll("&", "&amp;")}"`);
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

describe("isFollowingTranscriptBottom", () => {
  it("follows a transcript that is resting at the bottom", () => {
    expect(
      isFollowingTranscriptBottom({
        scrollHeight: 1861,
        scrollTop: 1349,
        clientHeight: 512,
      }),
    ).toBe(true);
  });

  it("still follows while the last line is settling into view", () => {
    expect(
      isFollowingTranscriptBottom({
        scrollHeight: 1861,
        scrollTop: 1317,
        clientHeight: 512,
      }),
    ).toBe(true);
  });

  it("yields once the teacher scrolls back to read an earlier card", () => {
    expect(
      isFollowingTranscriptBottom({
        scrollHeight: 1861,
        scrollTop: 400,
        clientHeight: 512,
      }),
    ).toBe(false);
  });

  it("follows a transcript too short to scroll", () => {
    expect(
      isFollowingTranscriptBottom({
        scrollHeight: 512,
        scrollTop: 0,
        clientHeight: 512,
      }),
    ).toBe(true);
  });
});
