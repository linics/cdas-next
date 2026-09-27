import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import {
  evidenceTypeLabel,
  isStructuredContent,
  type ActivityTaskPhase,
} from "../../../../domain/activity/activity-content";
import { hasMeaningfulTextEvidence } from "../../../../domain/submission/text-evidence";
import {
  teacherFeedbackNextStepLabels,
  teacherFeedbackSupportLevelLabels,
} from "../../../../domain/feedback/teacher-feedback-policy";
import {
  teacherEvaluationCitationKindLabels,
  teacherEvaluationLevelLabels,
  teacherEvaluationOutcomeStatusLabels,
} from "../../../../domain/evaluation/teacher-evaluation-policy";
import { AttachmentPreview } from "../../../_components/attachment-preview";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { isActivityAssistantEnabled } from "../../../../server/assistant/assistant-config";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  FeedbackWorkspaceQueryError,
  getTeacherFeedbackWorkspace,
  type TeacherFeedbackWorkspace,
} from "../../../../server/queries/feedback-workspace";
import { FeedbackComposer } from "./feedback-composer";
import { EvaluationComposer } from "./evaluation-composer";
import { FeedbackWorkspacePanes } from "./feedback-workspace-panes";
import { TeacherAccessGate, TeacherPage, teacherHomeCrumb } from "../../_components/teacher-shell";
import { Badge } from "@/components/ui/badge";
import { parseReviewQueueFilter, reviewQueueQuery } from "../../../../domain/review/review-queue";
import { getReviewQueuePosition } from "../../../../server/queries/review-queue";
import { SubmissionWorkspaceQueryError } from "../../../../server/queries/submission-workspace";
import { ReviewQueueNav } from "./review-queue-nav";
import { ArrowRightIcon, ClipboardListIcon } from "lucide-react";
import { StatusBadge } from "../../../_components/ui";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* 评阅页的版式：只用 Tailwind 语义类，颜色全部来自主题 token。 */
const styles = {
  submissionHistory: "mx-auto flex w-full max-w-3xl flex-col gap-5",
  paneHeading: "flex flex-col gap-1 border-b pb-4",
  eyebrow: "text-xs font-medium text-muted-foreground",
  contextLine: "text-sm text-muted-foreground",
  railNote:
    "flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground",
  railHint: "px-1 text-xs text-muted-foreground",
  historyHeading: "flex items-center justify-between gap-3",
  phaseContext:
    "flex flex-col gap-1 rounded-xl border border-primary/25 bg-accent/60 px-4 py-3 text-sm text-muted-foreground",
  submissionRevision: "flex flex-col gap-4",
  revisionHeading: "flex items-start justify-between gap-3",
  revisionIndex:
    "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums",
  revisionBadges: "flex gap-1.5",
  formalLabel: "text-xs text-muted-foreground",
  submissionBody:
    "glass rounded-2xl p-5 text-base leading-7 whitespace-pre-wrap",
  formalAttachmentList: "flex flex-col gap-2 text-sm",
  historyDisclosure:
    "group glass rounded-2xl [&>summary]:cursor-pointer [&>summary]:px-4 [&>summary]:py-3 [&>summary]:text-sm [&>summary]:font-medium [&[open]>summary]:border-b",
  revisionList: "flex flex-col gap-6 p-4",
  feedbackHistory: "flex flex-col gap-3 p-4 text-sm",
  feedbackVersions: "flex flex-col gap-3",
  feedbackMeta: "flex items-center gap-2 text-xs text-muted-foreground",
  feedbackBody: "rounded-md border bg-background p-3 whitespace-pre-wrap",
  feedbackStructure: "flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground",
  legacyFeedbackStructure: "text-xs text-muted-foreground",
  feedbackOwner: "text-xs text-muted-foreground",
  emptyFeedback: "text-sm text-muted-foreground",
  evaluationOutcomeList: "flex flex-col divide-y rounded-md border",
} as const;

function AccessUnavailable({
  code,
  submissionId,
}: {
  code: AuthenticationError["code"];
  submissionId: string;
}) {
  return (
    <TeacherAccessGate
      code={code}
      returnPath={`/teacher/submissions/${submissionId}`}
    />
  );
}

type FormalRevision =
  TeacherFeedbackWorkspace["submission"]["revisions"][number];

function FeedbackHistory({ revision }: { revision: FormalRevision }) {
  const feedback = revision.feedback;
  const revisions = feedback ? [...feedback.revisions].reverse() : [];

  return (
    <section
      className={styles.feedbackHistory}
      aria-labelledby={`feedback-history-${revision.id}`}
    >
      <header className="flex items-center justify-between">
        <h4 className="font-semibold" id={`feedback-history-${revision.id}`}>教师反馈</h4>
        <span className="text-xs text-muted-foreground tabular-nums">
          {feedback ? `v${feedback.currentVersion}` : "尚无反馈"}
        </span>
      </header>

      {feedback ? (
        <div className={styles.feedbackVersions}>
          {revisions.map((feedbackRevision, index) => (
            <article className="flex flex-col gap-2" key={feedbackRevision.id}>
              <div className={styles.feedbackMeta}>
                <Badge className="tabular-nums" variant="outline">v{feedbackRevision.version}</Badge>
                <p className="flex flex-wrap items-center gap-x-2">
                  {index === 0 ? <strong className="font-medium text-foreground">当前版本</strong> : null}
                  {feedbackRevision.source === "AI_ASSISTED"
                    ? "AI 建议 · 教师已确认"
                    : "教师撰写"}
                  <LocalizedDateTime
                    dateTime={feedbackRevision.confirmedAt}
                  />
                </p>
              </div>
              <div className={styles.feedbackBody}>
                {feedbackRevision.body}
              </div>
              {feedbackRevision.nextStep && feedbackRevision.supportLevel ? (
                <div className={styles.feedbackStructure}>
                  <span>
                    形成性下一步：
                    {teacherFeedbackNextStepLabels[feedbackRevision.nextStep]}
                  </span>
                  <span>
                    支架层级：
                    {teacherFeedbackSupportLevelLabels[
                      feedbackRevision.supportLevel
                    ]}
                  </span>
                </div>
              ) : (
                <p className={styles.legacyFeedbackStructure}>
                  早期反馈未包含下一步与支架信息
                </p>
              )}
            </article>
          ))}
          <p className={styles.feedbackOwner}>
            反馈教师：{feedback.teacher.displayName}
          </p>
        </div>
      ) : (
        <p className={styles.emptyFeedback}>
          该版本尚无教师反馈。
        </p>
      )}
    </section>
  );
}

function EvaluationHistory({ revision }: { revision: FormalRevision }) {
  const evaluation = revision.evaluation;
  const revisions = evaluation ? [...evaluation.revisions].reverse() : [];

  return (
    <section
      className={styles.feedbackHistory}
      aria-labelledby={`evaluation-history-${revision.id}`}
    >
      <header className="flex items-center justify-between">
        <h4 className="font-semibold" id={`evaluation-history-${revision.id}`}>量规评价</h4>
        <span className="text-xs text-muted-foreground tabular-nums">
          {evaluation ? `v${evaluation.currentVersion}` : "尚无评价"}
        </span>
      </header>

      {evaluation ? (
        <div className={styles.feedbackVersions}>
          {revisions.map((evaluationRevision, index) => (
            <article className="flex flex-col gap-2" key={evaluationRevision.id}>
              <div className={styles.feedbackMeta}>
                <Badge className="tabular-nums" variant="outline">v{evaluationRevision.version}</Badge>
                <p className="flex flex-wrap items-center gap-x-2">
                  {index === 0 ? <strong className="font-medium text-foreground">当前版本</strong> : null}
                  {evaluationRevision.source === "AI_ASSISTED"
                    ? "AI 建议 · 教师已确认"
                    : "教师撰写"}
                  <LocalizedDateTime
                    dateTime={evaluationRevision.confirmedAt}
                  />
                </p>
              </div>
              <ul className={styles.evaluationOutcomeList}>
                {evaluationRevision.outcomes.map((outcome) => (
                  <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-2" key={outcome.dimensionIndex}>
                    <strong className="font-medium">
                      {outcome.dimensionIndex}. {outcome.dimensionName}
                    </strong>
                    <span className="ml-auto font-medium">
                      {outcome.status === "LEVEL" && "level" in outcome
                        ? teacherEvaluationLevelLabels[outcome.level]
                        : teacherEvaluationOutcomeStatusLabels.INSUFFICIENT_EVIDENCE}
                    </span>
                    {outcome.citations.length > 0 ? (
                      <small className="w-full text-xs text-muted-foreground">
                        {outcome.citations
                          .map((citation) => {
                            if (citation.kind === "text") {
                              return teacherEvaluationCitationKindLabels.text;
                            }
                            if (citation.kind === "attachment") {
                              const filename =
                                revision.attachments.find(
                                  (attachment) =>
                                    attachment.id === citation.attachmentId,
                                )?.filename ?? citation.attachmentId;
                              return `${teacherEvaluationCitationKindLabels.attachment}：${filename}`;
                            }
                            return `${teacherEvaluationCitationKindLabels.checkpoint} ${citation.evidenceIndex}`;
                          })
                          .join("；")}
                      </small>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className={styles.feedbackBody}>
                {evaluationRevision.summary}
              </div>
            </article>
          ))}
          <p className={styles.feedbackOwner}>
            评价教师：{evaluation.teacher.displayName}
          </p>
        </div>
      ) : (
        <p className={styles.emptyFeedback}>
          该版本尚无量规评价。
        </p>
      )}
    </section>
  );
}

function SubmissionRevision({
  revision,
  current,
  phase,
}: {
  revision: FormalRevision;
  current: boolean;
  phase: ActivityTaskPhase | null;
}) {
  return (
    <article
      className={styles.submissionRevision}
      data-current={current ? "true" : "false"}
      aria-labelledby={
        current
          ? "submission-evidence-title"
          : `submission-revision-${revision.id}`
      }
    >
      {current ? null : (
        <header className={styles.revisionHeading}>
        <div className="flex items-start gap-3">
          <span className={styles.revisionIndex}>
            {String(revision.revisionNumber).padStart(2, "0")}
          </span>
          <div>
            <h3 className="text-sm font-semibold" id={`submission-revision-${revision.id}`}>
              第 {revision.revisionNumber} 版正式提交
            </h3>
            <LocalizedDateTime dateTime={revision.submittedAt} />
          </div>
        </div>
        <div className={styles.revisionBadges}>
          {current ? <Badge variant="secondary">当前正式版</Badge> : null}
          <Badge data-late={revision.isLate ? "true" : "false"} variant="outline">
            {revision.isLate ? "迟交" : "期限内"}
          </Badge>
        </div>
        </header>
      )}

      {current ? null : <p className={styles.formalLabel}>正式提交 · 不可修改</p>}
      {revision.textEvidence ? (
        <div className={styles.submissionBody}>{revision.textEvidence}</div>
      ) : null}
      {phase && revision.completedEvidenceIndexes.length > 0 ? (
        <ul className={styles.formalAttachmentList}>
          {revision.completedEvidenceIndexes.map((evidenceIndex) => {
            const evidence = phase.evidence[evidenceIndex - 1];
            return evidence ? (
              <li className="flex items-center justify-between gap-3 rounded-lg border p-3" key={evidenceIndex}>
                <strong className="font-medium">已确认：{evidence.description}</strong>
                <Badge variant="secondary">{evidenceTypeLabel(evidence.type)}</Badge>
              </li>
            ) : null;
          })}
        </ul>
      ) : null}
      {revision.attachments.length > 0 ? (
        <ul className={styles.formalAttachmentList}>
          {revision.attachments.map((attachment) => (
            <li className="flex flex-col gap-2 rounded-lg border p-3" key={attachment.id}>
              <a
                className="font-medium underline-offset-4 hover:underline"
                href={`/attachments/${attachment.id}/download`}
                download={attachment.filename}
              >
                {attachment.filename}
              </a>
              <span className="text-xs text-muted-foreground tabular-nums">{Math.ceil(attachment.byteSize / 1024)} KB</span>
              <AttachmentPreview attachment={attachment} />
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export default async function TeacherSubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ submissionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { submissionId } = await params;
  const queueFilter = parseReviewQueueFilter((await searchParams) ?? {});
  let workspace: TeacherFeedbackWorkspace;
  let queuePosition: Awaited<ReturnType<typeof getReviewQueuePosition>> | null =
    null;

  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    workspace = await getTeacherFeedbackWorkspace(database, context, {
      submissionId,
    });
    // Navigation is a convenience: if the roster cannot be read, the review
    // itself still renders, just without previous / next.
    queuePosition = await getReviewQueuePosition(database, context, {
      releaseId: workspace.submission.release.id,
      submissionId,
      filter: queueFilter,
    }).catch((error: unknown) => {
      if (error instanceof SubmissionWorkspaceQueryError) return null;
      throw error;
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <AccessUnavailable
          code={error.code}
          submissionId={submissionId}
        />
      );
    }
    if (
      error instanceof FeedbackWorkspaceQueryError ||
      error instanceof ZodError
    ) {
      notFound();
    }
    throw error;
  }

  const { submission, student, group } = workspace;
  const currentRevision = submission.revisions.at(-1);
  if (!currentRevision) {
    notFound();
  }
  const latestFeedbackRevision = currentRevision.feedback?.revisions.at(-1);
  const latestEvaluationRevision = currentRevision.evaluation?.revisions.at(-1);
  const content = submission.release.snapshot.content;
  const assistantEnabled = isActivityAssistantEnabled();
  const phase =
    isStructuredContent(content) && submission.phaseIndex > 0
      ? (content.phases[submission.phaseIndex - 1] ?? null)
      : null;
  const revisions = [...submission.revisions].reverse();
  const earlierRevisions = revisions.filter(
    (revision) => revision.id !== currentRevision.id,
  );
  const feedbackStatus = latestFeedbackRevision
    ? `v${latestFeedbackRevision.version}`
    : "无";
  const evaluationStatus = latestEvaluationRevision
    ? `v${latestEvaluationRevision.version}`
    : "无";
  const isFinalSubmission = submission.evaluationOpen || (
    !isStructuredContent(content) && submission.phaseIndex === 0
  );
  const reviewDone =
    Boolean(currentRevision.feedback) &&
    (!submission.evaluationOpen || Boolean(currentRevision.evaluation));

  return (
    <TeacherPage
      actorName={workspace.actor.displayName}
      fillViewport
      breadcrumb={[
        teacherHomeCrumb,
        {
          href: `/teacher/classrooms/${submission.release.classroom.id}/members`,
          label: submission.release.classroom.name,
        },
        {
          href: `/teacher/releases/${submission.release.id}/submissions${reviewQueueQuery(queueFilter)}`,
          label: content.title,
        },
        { label: group?.name ?? student.displayName },
      ]}
    >
      <FeedbackWorkspacePanes
        evidence={
          <section
            className={styles.submissionHistory}
            aria-labelledby="submission-student-title"
          >
            {queuePosition ? (
              <ReviewQueueNav
                filter={queueFilter}
                position={queuePosition}
                releaseId={submission.release.id}
              />
            ) : null}
            <header className={styles.paneHeading}>
              <p className={styles.eyebrow}>学生证据</p>
              <h1 className="type-page-title" id="submission-student-title">
                {group?.name ?? student.displayName}
              </h1>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge tone="neutral">
                  {submission.phaseName
                    ? `第 ${submission.phaseIndex} 阶段 · ${submission.phaseName}`
                    : "整项提交"}
                </StatusBadge>
                <StatusBadge tone="neutral">
                  第 {currentRevision.revisionNumber} 版
                </StatusBadge>
                {currentRevision.isLate ? (
                  <StatusBadge tone="resubmit">迟交</StatusBadge>
                ) : null}
                {submission.evaluationOpen ? (
                  <StatusBadge tone="neutral">终稿 · 需评价</StatusBadge>
                ) : null}
                <span className={styles.contextLine}>
                  {content.title} · {submission.release.classroom.name}
                  {submission.release.dueAt ? (
                    <>
                      {" · "}
                      <LocalizedDateTime dateTime={submission.release.dueAt} /> 截止
                    </>
                  ) : null}
                </span>
              </div>
            </header>
            {group ? (
              <section className={styles.railNote} role="note">
                <p className={styles.eyebrow}>小组共享提交</p>
                <p>
                  成员：
                  {group.members
                    .map(
                      (member) =>
                        `${member.student.displayName}${
                          member.roleLabel ? `（${member.roleLabel}）` : ""
                        }`,
                    )
                    .join("、")}
                  。本页反馈绑定这份共享正式修订，并对全组成员可见。
                </p>
              </section>
            ) : null}
            {phase ? (
              <aside className={styles.phaseContext} aria-label="这一阶段的要求">
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <ClipboardListIcon aria-hidden="true" className="size-3.5" />
                  这一阶段要求
                </p>
                <p>{phase.action}</p>
                <p>
                  <span className="font-medium text-foreground">评价要点：</span>
                  {phase.evaluationFocus}
                </p>
              </aside>
            ) : null}
            <h2 className="sr-only" id="submission-evidence-title">
              第 {currentRevision.revisionNumber} 版提交内容
            </h2>
            <SubmissionRevision
              revision={currentRevision}
              current
              phase={phase}
            />
            {earlierRevisions.length > 0 ? (
              <details className={styles.historyDisclosure}>
                <summary>更早的正式修订（{earlierRevisions.length}）</summary>
                <div className={styles.revisionList}>
                  {earlierRevisions.map((revision) => (
                    <SubmissionRevision
                      key={revision.id}
                      revision={revision}
                      current={false}
                      phase={phase}
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </section>
        }
      >
          {reviewDone && queuePosition?.nextId ? (
            <a
              className={cn(buttonVariants(), "w-full")}
              href={`/teacher/submissions/${queuePosition.nextId}${reviewQueueQuery(queueFilter)}`}
            >
              这一份已完成 · 下一份
              <ArrowRightIcon />
            </a>
          ) : reviewDone ? (
            <p className={styles.railNote} role="status">
              这一份已完成反馈{submission.evaluationOpen ? "和评价" : ""}。
            </p>
          ) : null}
          <FeedbackComposer
            key={`${currentRevision.id}:${currentRevision.feedback?.currentVersion ?? 0}`}
            submissionId={submission.id}
            submissionRevisionId={currentRevision.id}
            submissionRevisionNumber={currentRevision.revisionNumber}
            expectedFeedbackVersion={
              currentRevision.feedback?.currentVersion ?? 0
            }
            initialBody={latestFeedbackRevision?.body ?? ""}
            initialSupportLevel={latestFeedbackRevision?.supportLevel ?? null}
            finalSubmission={isFinalSubmission}
            prepareIdempotencySeed={`prepare_teacher_feedback_${randomUUID()}`}
            assistantEnabled={assistantEnabled}
          />
          {isStructuredContent(content) && submission.evaluationOpen ? (
            <EvaluationComposer
              key={`evaluation:${currentRevision.id}:${currentRevision.evaluation?.currentVersion ?? 0}`}
              submissionId={submission.id}
              submissionRevisionId={currentRevision.id}
              submissionRevisionNumber={currentRevision.revisionNumber}
              expectedEvaluationVersion={
                currentRevision.evaluation?.currentVersion ?? 0
              }
              rubricDimensions={content.rubricDimensions}
              hasTextEvidence={hasMeaningfulTextEvidence(
                currentRevision.textEvidence,
              )}
              attachments={currentRevision.attachments.map((attachment) => ({
                id: attachment.id,
                filename: attachment.filename,
              }))}
              checkpoints={
                phase
                  ? currentRevision.completedEvidenceIndexes.flatMap(
                      (evidenceIndex) => {
                        const evidence = phase.evidence[evidenceIndex - 1];
                        return evidence
                          ? [
                              {
                                evidenceIndex,
                                description: evidence.description,
                              },
                            ]
                          : [];
                      },
                    )
                  : []
              }
              initialSummary={latestEvaluationRevision?.summary ?? ""}
              prepareIdempotencySeed={`prepare_teacher_evaluation_${randomUUID()}`}
              assistantEnabled={assistantEnabled}
            />
          ) : isStructuredContent(content) ? (
            <p className={styles.railHint}>
              阶段提交只需反馈；量规评价在最终提交时进行。
            </p>
          ) : (
            <p className={styles.railHint}>
              旧版任务书没有量规，只需反馈。
            </p>
          )}
          {currentRevision.feedback || currentRevision.evaluation ? (
            <details className={styles.historyDisclosure}>
              <summary>
                已保存的记录（反馈 {feedbackStatus}
                {currentRevision.evaluation || submission.evaluationOpen
                  ? ` · 评价 ${evaluationStatus}`
                  : ""}
                ）
              </summary>
              <FeedbackHistory revision={currentRevision} />
              {currentRevision.evaluation ? (
                <EvaluationHistory revision={currentRevision} />
              ) : null}
            </details>
          ) : null}
          <a
            className="w-fit text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href={`/print/submissions/${submission.id}`}
          >
            打印学习成果报告
          </a>
      </FeedbackWorkspacePanes>
    </TeacherPage>
  );
}
