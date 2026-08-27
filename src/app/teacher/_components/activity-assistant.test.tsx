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
const draftProposal = {
  taskUnderstandingSummary: {
    realWorldContext: "校园需要改善用水。",
    studentAction: "记录并比较水表读数。",
    intendedOutcome: "提出节水建议。",
    evidenceAndAssessment: "以记录、分析和建议评价。",
  },
  teacherRequirements: ["七年级", "校园节水"],
  assumptions: [],
  integratedDisciplineContributions: [
    { disciplineCode: "math", necessaryContribution: "整理水表读数。" },
  ],
  alignmentChains: [
    { objectiveKind: "knowledge", objective: "理解数据。", task: "观察。", evidence: "记录。", assessment: "完整。" },
    { objectiveKind: "process", objective: "分析数据。", task: "比较。", evidence: "表格。", assessment: "有据。" },
    { objectiveKind: "emotion", objective: "承担责任。", task: "建议。", evidence: "建议稿。", assessment: "可行。" },
  ],
  sourceReferences: [
    {
      sourceId: "course-plan-2022",
      sectionId: "course-plan-2022-section",
      citationLabel: "《义务教育课程方案（2022年版）》· 基本原则",
      href: "/teacher/knowledge?source=course-plan-2022&section=course-plan-2022-section",
      reason: "用于校准跨学科任务的真实情境与实践要求。",
    },
  ],
  content: {},
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
    mocks.capturedOptions = null;
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
    expect(markup).toContain("官方来源依据");
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
