"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  formatDateTimeInstant,
  LocalizedDateTime,
} from "../../_components/localized-date-time";
import type { ActivityContentV2 } from "../../../domain/activity/activity-content";
import { AssistantMarkdown } from "./assistant-markdown";
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
  const router = useRouter();
  const navigatedToolCalls = useRef(new Set<string>());
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ActivityAssistantMessage>({
        api,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages },
        }),
      }),
    [api],
  );
  const session = useChat<ActivityAssistantMessage>({
    transport,
    sendAutomaticallyWhen:
      lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ message }) => {
      for (const part of message.parts) {
        if (
          part.type !== "tool-create_activity_draft" ||
          part.state !== "output-available" ||
          navigatedToolCalls.current.has(part.toolCallId)
        ) {
          continue;
        }
        const base = `/teacher/activities/${part.output.draftId}`;
        const expectedEditHref = base;
        const expectedPreviewHref = `${base}/preview`;
        if (
          part.output.status === "READY_FOR_PREVIEW" &&
          part.output.editHref === expectedEditHref &&
          part.output.previewHref === expectedPreviewHref
        ) {
          navigatedToolCalls.current.add(part.toolCallId);
          router.push(expectedPreviewHref);
        }
      }
    },
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

function ActivityDraftProposalCard({
  proposal,
  toolCallId,
  approval,
  onRespond,
}: Readonly<{
  proposal: ActivityDraftProposal;
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
          <dt>证据、评价与叙事自检</dt>
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
      <section className={styles.proposalSection} aria-label="官方来源依据">
        <h3>官方来源依据</h3>
        {proposal.sourceReferences.length > 0 ? (
          <ul className={styles.referenceList}>
            {proposal.sourceReferences.map((reference) => (
              <li key={`${reference.sourceId}:${reference.sectionId}`}>
                <Link href={reference.href}>{reference.citationLabel}</Link>
                <p>{reference.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>首版官方语料中未找到与本活动直接对应的学科章节。</p>
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

  if (continuationOnly && messages.length === 0) {
    return null;
  }

  return (
    <section className={styles.assistant} aria-labelledby="activity-assistant-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>AI 活动助手 · 试行</p>
          <h2 id="activity-assistant-title">
            {continuationOnly ? "继续核对活动并准备发布" : "把活动构想整理成可编辑草稿"}
          </h2>
        </div>
        <span className={styles.availability} data-busy={busy}>
          {busy ? "处理中" : "可使用"}
        </span>
      </header>

      <p className={styles.boundaryNote}>
        助手只会创建「可预览」草稿；你仍可进入编辑页逐项修改。发布前会另行列出草稿版本、班级与截止时间，没有你的明确确认就不会发布。
        助手不可用时，手动创建与编辑活动仍可正常使用。你也可以
        <Link href="/teacher/knowledge">直接检索首版官方课程标准</Link>。
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
                    if (!part.text) return null;
                    if (message.role === "assistant") {
                      return (
                        <AssistantMarkdown key={index}>
                          {part.text}
                        </AssistantMarkdown>
                      );
                    }
                    return <p key={index}>{part.text}</p>;
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
                            首版官方语料中没有找到直接匹配的章节。
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
          例如：「帮我设计一个七年级校园节水活动，学生要记录两次水表读数，并用证据提出改善建议。」
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
