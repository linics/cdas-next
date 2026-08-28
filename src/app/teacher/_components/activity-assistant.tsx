"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  formatDateTimeInstant,
  LocalizedDateTime,
} from "../../_components/localized-date-time";
import type { ActivityContentV2 } from "../../../domain/activity/activity-content";
import { getTeacherAgentPageContext } from "../../../domain/assistant/teacher-agent-page-context";
import styles from "./activity-assistant.module.css";

type CreatedDraftOutput = {
  draftId: string;
  version: number;
  status: "READY_FOR_PREVIEW";
  editHref: string;
  previewHref: string;
};

type PublishInput = {
  draftId: string;
  expectedDraftVersion: number;
  classroomId: string;
  dueAt: string | null;
};

type CurrentTeacherContextOutput = {
  status: "AVAILABLE" | "UNAVAILABLE";
  kind:
    | "TEACHER_DASHBOARD"
    | "ACTIVITY_NEW"
    | "ACTIVITY_DRAFT"
    | "ACTIVITY_PREVIEW"
    | "RELEASE_SUBMISSIONS"
    | "SUBMISSION_REVIEW"
    | "TEACHER_INSIGHTS"
    | "TEACHER_KNOWLEDGE"
    | "CLASSROOM_MEMBERS"
    | "UNKNOWN_TEACHER_PAGE";
  label: string;
  href: string | null;
};

type TeacherClassroomListOutput = {
  classrooms: Array<{
    id: string;
    name: string;
    currentMemberCount: number;
    href: string;
  }>;
};

type TeacherDraftListOutput = {
  drafts: Array<{
    id: string;
    title: string;
    status: "EDITING" | "READY_FOR_PREVIEW" | "SEALED";
    version: number;
    updatedAt: string;
    editHref: string;
    previewHref: string;
  }>;
};

type TeacherReleaseListOutput = {
  releases: Array<{
    id: string;
    title: string;
    classroomName: string;
    status: "ACTIVE" | "CLOSED" | "ARCHIVED";
    publishedAt: string;
    dueAt: string | null;
    progress: { submittedCount: number; cohortSize: number } | null;
    attention: {
      pendingFeedbackCount: number;
      pendingEvaluationCount: number;
      awaitingResubmissionCount: number;
    } | null;
    submissionsHref: string | null;
  }>;
};

type TeacherDraftDetailOutput =
  | {
      status: "FOUND";
      draftId: string;
      draftStatus: "EDITING" | "READY_FOR_PREVIEW" | "SEALED";
      version: number;
      updatedAt: string;
      published: boolean;
      editHref: string;
      previewHref: string;
      content: ActivityContentV2;
    }
  | {
      status: "LEGACY_SNAPSHOT";
      draftId: string;
      title: string;
      editHref: string;
      previewHref: string;
    }
  | { status: "NOT_FOUND"; draftId: string };

const draftNotCreatedRetryText =
  '草稿未创建。你可以补一句"请重新创建草稿"让助手重试，或改用手动表单。';

type OfficialKnowledgeSearchOutput = {
  status: "FOUND" | "NO_MATCH";
  results: Array<{
    sourceId: string;
    sectionId: string;
    sourceTitle: string;
    locator: string;
    citationLabel: string;
    excerpt: string;
    href: string;
    sourceUrl: string;
  }>;
};

type OfficialKnowledgeReadOutput =
  | {
      status: "FOUND";
      sourceId: string;
      sectionId: string;
      sourceTitle: string;
      publisher: "中华人民共和国教育部";
      version: "2022年版";
      locator: string;
      citationLabel: string;
      content: string;
      href: string;
      sourceUrl: string;
    }
  | {
      status: "NOT_FOUND";
      sourceId: string;
      sectionId: string;
    };

type ActivityDraftProposal = {
  taskUnderstandingSummary: {
    realWorldContext: string;
    studentAction: string;
    intendedOutcome: string;
    evidenceAndAssessment: string;
  };
  teacherRequirements: string[];
  assumptions: string[];
  integratedDisciplineContributions: Array<{
    disciplineCode: string;
    necessaryContribution: string;
  }>;
  alignmentChains: Array<{
    objectiveKind: "knowledge" | "process" | "emotion";
    objective: string;
    task: string;
    evidence: string;
    assessment: string;
  }>;
  sourceReferences: Array<{
    sourceId: string;
    sectionId: string;
    citationLabel: string;
    href: string;
    reason: string;
  }>;
  content: ActivityContentV2;
};

type ActivityAssistantMessage = UIMessage<
  undefined,
  never,
  {
    get_current_context: {
      input: Record<string, never>;
      output: CurrentTeacherContextOutput;
    };
    list_my_classrooms: {
      input: Record<string, never>;
      output: TeacherClassroomListOutput;
    };
    list_my_activity_drafts: {
      input: Record<string, never>;
      output: TeacherDraftListOutput;
    };
    list_my_releases: {
      input: Record<string, never>;
      output: TeacherReleaseListOutput;
    };
    get_activity_draft: {
      input: { draftId: string };
      output: TeacherDraftDetailOutput;
    };
    search_knowledge: {
      input: {
        query: string;
        schoolStage?: "PRIMARY" | "MIDDLE";
        disciplineCodes?: string[];
        limit?: number;
      };
      output: OfficialKnowledgeSearchOutput;
    };
    read_source_section: {
      input: { sourceId: string; sectionId: string };
      output: OfficialKnowledgeReadOutput;
    };
    create_activity_draft: {
      input: ActivityDraftProposal;
      output: CreatedDraftOutput;
    };
    publish_activity_release: {
      input: PublishInput;
      output: {
        releaseId: string;
        status: "PUBLISHED";
        publishedAt: string;
        releaseHref: string;
      };
    };
  }
>;

export type ActivityAssistantClassroom = Readonly<{
  id: string;
  name: string;
}>;

export type ActivityAssistantProps = Readonly<{
  classrooms: ActivityAssistantClassroom[];
  continuationOnly?: boolean;
  surface?: "inline" | "panel";
}>;

type ActivityAssistantSession = ReturnType<
  typeof useChat<ActivityAssistantMessage>
>;

const ActivityAssistantSessionContext = createContext<
  ActivityAssistantSession | null
>(null);

const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

export function ActivityAssistantSessionProvider({
  children,
  api = "/api/assistant/activity-draft",
}: Readonly<{
  children: ReactNode;
  api?: string;
}>) {
  const pathname = usePathname();
  const pageContext = useMemo(
    () => getTeacherAgentPageContext(pathname),
    [pathname],
  );
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ActivityAssistantMessage>({
        api,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            messages,
            pageContext,
          },
        }),
      }),
    [api, pageContext],
  );
  const session = useChat<ActivityAssistantMessage>({
    transport,
    sendAutomaticallyWhen:
      lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  return (
    <ActivityAssistantSessionContext.Provider value={session}>
      {children}
    </ActivityAssistantSessionContext.Provider>
  );
}

function useActivityAssistantSession(): ActivityAssistantSession {
  const session = useContext(ActivityAssistantSessionContext);
  if (!session) {
    throw new Error("ACTIVITY_ASSISTANT_SESSION_PROVIDER_REQUIRED");
  }
  return session;
}

function DueAtLabel({ dueAt }: { dueAt: string | null }) {
  if (!dueAt) {
    return "未设置截止时间";
  }
  try {
    formatDateTimeInstant(dueAt);
  } catch {
    return "截止时间格式无效";
  }
  return <LocalizedDateTime dateTime={dueAt} />;
}

const objectiveKindLabel = {
  knowledge: "知识与技能",
  process: "过程与方法",
  emotion: "情感态度",
} as const;

const readOnlyDraftStatusLabel = {
  EDITING: "编辑中",
  READY_FOR_PREVIEW: "可预览",
  SEALED: "已封存",
} as const;

const readOnlyReleaseStatusLabel = {
  ACTIVE: "开放中",
  CLOSED: "已关闭",
  ARCHIVED: "已封存",
} as const;

function ActivityDraftProposalCard({
  proposal,
  readSections,
  toolCallId,
  approval,
  onRespond,
}: Readonly<{
  proposal: ActivityDraftProposal;
  readSections: ReadonlyMap<
    string,
    { sourceTitle: string; locator: string; content: string; sourceUrl: string }
  >;
  toolCallId: string;
  approval: { id: string; isAutomatic?: boolean };
  onRespond: (response: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void;
}>) {
  return (
    <div
      className={styles.approval}
      key={toolCallId}
      role="group"
      aria-label="任务理解确认"
    >
      <strong>先确认这份可编辑的任务理解</strong>
      <p>
        这是创建草稿前的建议，不是课程质量结论。确认后仍可在草稿页逐项修改。
      </p>
      <dl className={styles.proposalSummary}>
        <div>
          <dt>真实情境</dt>
          <dd>{proposal.taskUnderstandingSummary.realWorldContext}</dd>
        </div>
        <div>
          <dt>学生行动</dt>
          <dd>{proposal.taskUnderstandingSummary.studentAction}</dd>
        </div>
        <div>
          <dt>预期成果</dt>
          <dd>{proposal.taskUnderstandingSummary.intendedOutcome}</dd>
        </div>
        <div>
          <dt>证据与评价</dt>
          <dd>{proposal.taskUnderstandingSummary.evidenceAndAssessment}</dd>
        </div>
      </dl>
      <section className={styles.proposalSection} aria-label="教师已提供要求">
        <h3>教师已提供要求</h3>
        <ul>{proposal.teacherRequirements.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      <section className={styles.proposalSection} aria-label="明确假设">
        <h3>明确假设</h3>
        {proposal.assumptions.length > 0 ? (
          <ul>{proposal.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : <p>没有新增假设。</p>}
      </section>
      <section className={styles.proposalSection} aria-label="跨学科必要性">
        <h3>跨学科必要性</h3>
        <dl>
          {proposal.integratedDisciplineContributions.map((item) => (
            <div key={item.disciplineCode}>
              <dt>{item.disciplineCode}</dt>
              <dd>{item.necessaryContribution}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={styles.proposalSection} aria-label="目标任务证据评价一致性链">
        <h3>目标—任务—证据—评价一致性链</h3>
        <dl>
          {proposal.alignmentChains.map((chain) => (
            <div key={chain.objectiveKind}>
              <dt>{objectiveKindLabel[chain.objectiveKind]}</dt>
              <dd>
                目标：{chain.objective}<br />
                任务：{chain.task}<br />
                证据：{chain.evidence}<br />
                评价：{chain.assessment}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={styles.proposalSection} aria-label="本次设计参考了哪些依据">
        <h3>本次设计参考了哪些依据</h3>
        {proposal.sourceReferences.length > 0 ? (
          <ul className={styles.referenceList}>
            {proposal.sourceReferences.map((reference) => {
              const section = readSections.get(
                `${reference.sourceId}:${reference.sectionId}`,
              );
              return (
                <li key={`${reference.sourceId}:${reference.sectionId}`}>
                  <details>
                    <summary>{reference.citationLabel}</summary>
                    <p>{reference.reason}</p>
                    {section ? (
                      <>
                        <p className={styles.sourceMeta}>
                          {section.sourceTitle} · {section.locator}
                        </p>
                        <blockquote className={styles.sourceExcerpt}>
                          {section.content}
                        </blockquote>
                      </>
                    ) : null}
                    <Link href={reference.href}>在课程依据页打开这一节</Link>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>
            语料中未找到依据。首版语料只收教育部课程方案与语文、数学、物理、信息科技
            四科课程标准；本次设计未引用任何官方来源，请在确认前自行核对。
          </p>
        )}
        <p className={styles.referenceCaveat}>
          引用用于说明设计依据，不代表活动已自动通过课程标准合规审查。
        </p>
      </section>
      <div className={styles.inlineActions}>
        <button
          type="button"
          onClick={() => onRespond({ id: approval.id, approved: true })}
        >
          确认理解并创建草稿
        </button>
        <button
          type="button"
          data-tone="quiet"
          onClick={() =>
            onRespond({
              id: approval.id,
              approved: false,
              reason: "教师选择继续补充活动要求",
            })
          }
        >
          继续补充
        </button>
      </div>
    </div>
  );
}

export function ActivityAssistant({
  classrooms,
  continuationOnly = false,
  surface = "inline",
}: ActivityAssistantProps) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    hydratedSnapshot,
    serverSnapshot,
  );
  const [input, setInput] = useState("");
  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    addToolApprovalResponse,
  } = useActivityAssistantSession();
  const classroomNames = useMemo(
    () => new Map(classrooms.map((classroom) => [classroom.id, classroom.name])),
    [classrooms],
  );
  const busy = status === "submitted" || status === "streaming";
  // 提案里的每条引用都必须先经 read_source_section 通读（工具会拒绝未通读的引用），
  // 所以原文一定已经在这段对话的消息流里 —— 就地展开，不必把教师带离对话。
  const readSections = useMemo(() => {
    const sections = new Map<
      string,
      { sourceTitle: string; locator: string; content: string; sourceUrl: string }
    >();
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type === "tool-read_source_section" &&
          part.state === "output-available" &&
          part.output.status === "FOUND"
        ) {
          sections.set(`${part.output.sourceId}:${part.output.sectionId}`, {
            sourceTitle: part.output.sourceTitle,
            locator: part.output.locator,
            content: part.output.content,
            sourceUrl: part.output.sourceUrl,
          });
        }
      }
    }
    return sections;
  }, [messages]);

  if (continuationOnly && messages.length === 0) {
    return null;
  }

  const assistantTitleId =
    surface === "panel"
      ? "activity-assistant-panel-title"
      : "activity-assistant-title";

  return (
    <section
      className={styles.assistant}
      data-surface={surface}
      aria-labelledby={assistantTitleId}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            {surface === "panel" ? "当前职责" : "AI 活动助手 · 试行"}
          </p>
          <h2 id={assistantTitleId}>
            {surface === "panel"
              ? "教师工作区与活动设计"
              : continuationOnly
                ? "继续核对活动并准备发布"
                : "把活动构想整理成可编辑草稿"}
          </h2>
        </div>
        {busy ? (
          <span className={styles.availability} data-busy="true">
            处理中
          </span>
        ) : null}
      </header>

      <p className={styles.boundaryNote}>
        {surface === "panel" ? (
          <>
            可识别当前页面，查询你的班级、草稿、发布与待办，也可检索课程依据、设计活动，并经你确认后创建草稿或发布。所有站内跳转都由你点击；刷新会话即清空，手动流程不受影响。
          </>
        ) : (
          <>
            这是独立的教师会话，可检索官方课程依据、设计活动，并在你确认后创建「可预览」草稿。发布前会另行列出草稿版本、班级与截止时间，没有你的明确确认就不会发布。
            助手不可用时，手动创建与编辑活动仍可正常使用。你也可以
            <Link href="/teacher/knowledge">直接检索首版官方课程标准</Link>。
          </>
        )}
      </p>

      {messages.length > 0 ? (
        <div className={styles.transcript} aria-live="polite">
          {messages.map((message) => (
            <article
              className={styles.turn}
              data-role={message.role}
              key={message.id}
            >
              <p className={styles.speaker}>
                {message.role === "user" ? "你" : "活动助手"}
              </p>
              <div className={styles.turnBody}>
                {message.parts.map((part, index) => {
                  if (part.type === "text") {
                    return part.text ? <p key={index}>{part.text}</p> : null;
                  }

                  if (part.type === "tool-get_current_context") {
                    if (part.state === "output-available") {
                      return (
                        <div className={styles.toolResult} key={part.toolCallId}>
                          <strong>当前页面</strong>
                          <p>{part.output.label}</p>
                          {part.output.href ? (
                            <Link href={part.output.href}>打开当前页面</Link>
                          ) : null}
                        </div>
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          当前页面识别失败；你仍可使用原页面导航。
                        </p>
                      );
                    }
                    return (
                      <p className={styles.toolProgress} key={part.toolCallId}>
                        正在安全识别当前页面…
                      </p>
                    );
                  }

                  if (part.type === "tool-list_my_classrooms") {
                    if (part.state === "output-available") {
                      return (
                        <div className={styles.toolResult} key={part.toolCallId}>
                          <strong>我的班级 · {part.output.classrooms.length}</strong>
                          {part.output.classrooms.length > 0 ? (
                            <ul className={styles.referenceList}>
                              {part.output.classrooms.map((classroom) => (
                                <li key={classroom.id}>
                                  <Link href={classroom.href}>{classroom.name}</Link>
                                  <p>当前成员 {classroom.currentMemberCount} 人</p>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>当前没有你管理的班级。</p>
                          )}
                        </div>
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          班级摘要查询失败；请回到教师工作台查看。
                        </p>
                      );
                    }
                    return (
                      <p className={styles.toolProgress} key={part.toolCallId}>
                        正在查询你的班级…
                      </p>
                    );
                  }

                  if (part.type === "tool-list_my_activity_drafts") {
                    if (part.state === "output-available") {
                      return (
                        <div className={styles.toolResult} key={part.toolCallId}>
                          <strong>我的草稿 · {part.output.drafts.length}</strong>
                          {part.output.drafts.length > 0 ? (
                            <ul className={styles.referenceList}>
                              {part.output.drafts.map((draft) => (
                                <li key={draft.id}>
                                  <Link href={draft.editHref}>{draft.title}</Link>
                                  <p>
                                    版本 {draft.version} · {readOnlyDraftStatusLabel[draft.status]}
                                  </p>
                                  <Link href={draft.previewHref}>查看预览</Link>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>当前没有活动草稿。</p>
                          )}
                        </div>
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          草稿摘要查询失败；请回到教师工作台查看。
                        </p>
                      );
                    }
                    return (
                      <p className={styles.toolProgress} key={part.toolCallId}>
                        正在查询你的活动草稿…
                      </p>
                    );
                  }

                  if (part.type === "tool-list_my_releases") {
                    if (part.state === "output-available") {
                      return (
                        <div className={styles.toolResult} key={part.toolCallId}>
                          <strong>我的发布与待办 · {part.output.releases.length}</strong>
                          {part.output.releases.length > 0 ? (
                            <ul className={styles.referenceList}>
                              {part.output.releases.map((release) => {
                                const attention = release.attention;
                                const todo = attention
                                  ? [
                                      attention.pendingFeedbackCount > 0
                                        ? `待反馈 ${attention.pendingFeedbackCount}`
                                        : null,
                                      attention.pendingEvaluationCount > 0
                                        ? `待评价 ${attention.pendingEvaluationCount}`
                                        : null,
                                      attention.awaitingResubmissionCount > 0
                                        ? `待重交 ${attention.awaitingResubmissionCount}`
                                        : null,
                                    ].filter(Boolean)
                                  : [];
                                return (
                                  <li key={release.id}>
                                    {release.submissionsHref ? (
                                      <Link href={release.submissionsHref}>
                                        {release.title}
                                      </Link>
                                    ) : (
                                      <strong>{release.title}</strong>
                                    )}
                                    <p>
                                      {release.classroomName} · {readOnlyReleaseStatusLabel[release.status]}
                                      {release.progress
                                        ? ` · 已提交 ${release.progress.submittedCount}/${release.progress.cohortSize}`
                                        : ""}
                                    </p>
                                    <p>
                                      发布于 <LocalizedDateTime dateTime={release.publishedAt} />
                                    </p>
                                    <p>{todo.length > 0 ? todo.join(" · ") : "当前无待办"}</p>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p>当前没有活动发布。</p>
                          )}
                        </div>
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          发布与待办查询失败；请回到教师工作台查看。
                        </p>
                      );
                    }
                    return (
                      <p className={styles.toolProgress} key={part.toolCallId}>
                        正在查询你的发布与待办…
                      </p>
                    );
                  }

                  if (part.type === "tool-get_activity_draft") {
                    if (part.state === "output-available") {
                      if (part.output.status === "NOT_FOUND") {
                        return (
                          <p className={styles.errorText} key={part.toolCallId}>
                            这份草稿不在你的工作区，或你已无权查看。
                          </p>
                        );
                      }
                      if (part.output.status === "LEGACY_SNAPSHOT") {
                        return (
                          <div className={styles.toolResult} key={part.toolCallId}>
                            <strong>读取草稿 · {part.output.title}</strong>
                            <p>这是旧版快照草稿，助手不读取其正文。</p>
                            <Link href={part.output.editHref}>打开草稿</Link>
                          </div>
                        );
                      }
                      return (
                        <div className={styles.toolResult} key={part.toolCallId}>
                          <strong>读取草稿 · {part.output.content.title}</strong>
                          <p>
                            版本 {part.output.version} ·{" "}
                            {readOnlyDraftStatusLabel[part.output.draftStatus]}
                            {part.output.published ? " · 已发布" : ""}
                          </p>
                          <p>
                            {part.output.content.phases.length} 个阶段 ·{" "}
                            {part.output.content.rubricDimensions.length} 个量规维度 · 更新于{" "}
                            <LocalizedDateTime dateTime={part.output.updatedAt} />
                          </p>
                          <div className={styles.inlineActions}>
                            <Link href={part.output.editHref}>打开草稿</Link>
                            <Link href={part.output.previewHref}>查看预览</Link>
                          </div>
                        </div>
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          草稿读取失败；请直接打开草稿页查看。
                        </p>
                      );
                    }
                    return (
                      <p className={styles.toolProgress} key={part.toolCallId}>
                        正在读取这份草稿…
                      </p>
                    );
                  }

                  if (part.type === "tool-search_knowledge") {
                    if (!part.input || part.state === "input-streaming") {
                      return (
                        <p className={styles.toolProgress} key={part.toolCallId}>
                          正在检索教育部课程方案与课程标准…
                        </p>
                      );
                    }
                    if (part.state === "output-available") {
                      if (part.output.status === "NO_MATCH") {
                        return (
                          <p className={styles.toolProgress} key={part.toolCallId}>
                            语料中未找到依据（首版只收课程方案与语文、数学、物理、信息科技）。
                          </p>
                        );
                      }
                      return (
                        <details className={styles.knowledgeResult} key={part.toolCallId}>
                          <summary>
                            已找到 {part.output.results.length} 个官方标准片段
                          </summary>
                          <ul className={styles.referenceList}>
                            {part.output.results.map((result) => (
                              <li key={result.sectionId}>
                                <Link href={result.href}>{result.citationLabel}</Link>
                                <p>{result.excerpt}</p>
                              </li>
                            ))}
                          </ul>
                        </details>
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          官方标准检索失败；你仍可继续手动设计活动。
                        </p>
                      );
                    }
                    return (
                      <p className={styles.toolProgress} key={part.toolCallId}>
                        正在整理检索结果…
                      </p>
                    );
                  }

                  if (part.type === "tool-read_source_section") {
                    if (!part.input || part.state === "input-streaming") {
                      return (
                        <p className={styles.toolProgress} key={part.toolCallId}>
                          正在读取官方标准原文…
                        </p>
                      );
                    }
                    if (part.state === "output-available") {
                      if (part.output.status === "NOT_FOUND") {
                        return (
                          <p className={styles.errorText} key={part.toolCallId}>
                            该来源章节不存在，助手不会使用它。
                          </p>
                        );
                      }
                      return (
                        <details className={styles.knowledgeResult} key={part.toolCallId}>
                          <summary>已读取：{part.output.citationLabel}</summary>
                          <p>{part.output.content}</p>
                          <Link href={part.output.href}>打开来源章节</Link>
                        </details>
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          来源原文读取失败；助手不会编造引用。
                        </p>
                      );
                    }
                    return (
                      <p className={styles.toolProgress} key={part.toolCallId}>
                        正在核对来源章节…
                      </p>
                    );
                  }

                  if (part.type === "tool-create_activity_draft") {
                    if (
                      part.state === "approval-requested" &&
                      part.input &&
                      !part.approval.isAutomatic
                    ) {
                      return (
                        <ActivityDraftProposalCard
                          key={part.toolCallId}
                          proposal={part.input}
                          readSections={readSections}
                          toolCallId={part.toolCallId}
                          approval={part.approval}
                          onRespond={addToolApprovalResponse}
                        />
                      );
                    }
                    if (part.state === "output-available") {
                      return (
                        <div className={styles.toolResult} key={part.toolCallId}>
                          <strong>草稿已创建 · 版本 {part.output.version}</strong>
                          <p>内容已标记为可预览，可以先检查或继续编辑。</p>
                          <div className={styles.inlineActions}>
                            <Link href={part.output.previewHref}>查看预览</Link>
                            <Link href={part.output.editHref}>继续编辑</Link>
                          </div>
                        </div>
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          {part.input
                            ? "草稿未创建。请重新确认内容或改用手动表单。"
                            : draftNotCreatedRetryText}
                        </p>
                      );
                    }
                    if (part.state === "output-denied") {
                      return (
                        <p className={styles.toolProgress} key={part.toolCallId}>
                          已保留这份建议，尚未创建草稿。你可以继续补充要求或改用手动表单。
                        </p>
                      );
                    }
                    if (!busy) {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          {draftNotCreatedRetryText}
                        </p>
                      );
                    }
                    if (!part.input) {
                      return (
                        <p className={styles.toolProgress} key={part.toolCallId}>
                          正在整理任务理解与设计建议…
                        </p>
                      );
                    }
                    return (
                      <p className={styles.toolProgress} key={part.toolCallId}>
                        正在等待任务理解确认…
                      </p>
                    );
                  }

                  if (part.type === "tool-publish_activity_release") {
                    if (!part.input) {
                      return (
                        <p className={styles.toolProgress} key={part.toolCallId}>
                          正在准备发布参数…
                        </p>
                      );
                    }
                    const classroomName =
                      (part.input.classroomId
                        ? classroomNames.get(part.input.classroomId)
                        : undefined) ??
                      "无权辨识的班级";
                    if (
                      part.state === "approval-requested" &&
                      !part.approval.isAutomatic
                    ) {
                      return (
                        <div
                          className={styles.approval}
                          key={part.toolCallId}
                          role="group"
                          aria-label="发布确认"
                        >
                          <strong>确认发布这个精确版本？</strong>
                          <dl>
                            <div>
                              <dt>草稿版本</dt>
                              <dd>版本 {part.input.expectedDraftVersion}</dd>
                            </div>
                            <div>
                              <dt>目标班级</dt>
                              <dd>{classroomName}</dd>
                            </div>
                            <div>
                              <dt>截止时间</dt>
                              <dd>
                                <DueAtLabel dueAt={part.input.dueAt ?? null} />
                              </dd>
                            </div>
                          </dl>
                          <div className={styles.inlineActions}>
                            <button
                              type="button"
                              onClick={() =>
                                addToolApprovalResponse({
                                  id: part.approval.id,
                                  approved: true,
                                })
                              }
                            >
                              确认并发布
                            </button>
                            <button
                              type="button"
                              data-tone="quiet"
                              onClick={() =>
                                addToolApprovalResponse({
                                  id: part.approval.id,
                                  approved: false,
                                  reason: "教师取消发布",
                                })
                              }
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      );
                    }
                    if (part.state === "output-available") {
                      return (
                        <div className={styles.toolResult} key={part.toolCallId}>
                          <strong>活动已发布</strong>
                          <p>
                            <DueAtLabel dueAt={part.output.publishedAt} />{" "}
                            完成不可变快照。
                          </p>
                          <Link href={part.output.releaseHref}>查看学生提交</Link>
                        </div>
                      );
                    }
                    if (part.state === "output-denied") {
                      return (
                        <p className={styles.toolProgress} key={part.toolCallId}>
                          已取消发布，没有创建 Release。
                        </p>
                      );
                    }
                    if (part.state === "output-error") {
                      return (
                        <p className={styles.errorText} key={part.toolCallId}>
                          发布未完成；可能是版本、班级权限或状态已变更。请回到预览页核对。
                        </p>
                      );
                    }
                    return (
                      <p className={styles.toolProgress} key={part.toolCallId}>
                        正在准备发布参数…
                      </p>
                    );
                  }

                  return null;
                })}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.emptyPrompt}>
          {surface === "panel"
            ? "可分配职责：告诉我当前页面，列出我的班级、草稿、发布和待办；也可检索课程依据、整理活动设计、创建草稿或准备发布。"
            : "例如：「帮我设计一个七年级校园节水活动，学生要记录两次水表读数，并用证据提出改善建议。」"}
        </p>
      )}

      {error ? (
        <p className={styles.errorText} role="alert">
          助手当前无法完成请求。手动创建与编辑活动仍可正常使用。
        </p>
      ) : null}

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          const text = input.trim();
          if (!text || busy) {
            return;
          }
          void sendMessage({ text });
          setInput("");
        }}
      >
        <label htmlFor="activity-assistant-prompt">描述活动构想或下一步</label>
        <textarea
          id="activity-assistant-prompt"
          data-hydrated={hydrated}
          disabled={!hydrated}
          value={input}
          maxLength={4_000}
          rows={4}
          placeholder="交代年级、主题、学生任务、证据与反馈标准…"
          onChange={(event) => setInput(event.target.value)}
        />
        <div className={styles.composerFooter}>
          <span>{input.length} / 4000</span>
          {busy ? (
            <button type="button" data-tone="quiet" onClick={() => stop()}>
              停止
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!hydrated || busy || input.trim().length === 0}
          >
            交给助手整理
          </button>
        </div>
      </form>
    </section>
  );
}
