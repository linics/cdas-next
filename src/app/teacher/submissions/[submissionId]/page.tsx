import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { evidenceTypeLabel } from "../../../../domain/activity/activity-content";
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
import styles from "./feedback-workspace.module.css";

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
      <header>
        <h4 id={`feedback-history-${revision.id}`}>教师反馈</h4>
        <span>
          {feedback ? `v${feedback.currentVersion}` : "尚无反馈"}
        </span>
      </header>

      {feedback ? (
        <div className={styles.feedbackVersions}>
          {revisions.map((feedbackRevision, index) => (
            <article key={feedbackRevision.id}>
              <div className={styles.feedbackMeta}>
                <span>v{feedbackRevision.version}</span>
                <p>
                  {index === 0 ? <strong>当前版本</strong> : null}
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
      <header>
        <h4 id={`evaluation-history-${revision.id}`}>量规评价</h4>
        <span>
          {evaluation ? `v${evaluation.currentVersion}` : "尚无评价"}
        </span>
      </header>

      {evaluation ? (
        <div className={styles.feedbackVersions}>
          {revisions.map((evaluationRevision, index) => (
            <article key={evaluationRevision.id}>
              <div className={styles.feedbackMeta}>
                <span>v{evaluationRevision.version}</span>
                <p>
                  {index === 0 ? <strong>当前版本</strong> : null}
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
                  <li key={outcome.dimensionIndex}>
                    <strong>
                      {outcome.dimensionIndex}. {outcome.dimensionName}
                    </strong>
                    <span>
                      {outcome.status === "LEVEL" && "level" in outcome
                        ? teacherEvaluationLevelLabels[outcome.level]
                        : teacherEvaluationOutcomeStatusLabels.INSUFFICIENT_EVIDENCE}
                    </span>
                    {outcome.citations.length > 0 ? (
                      <small>
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
  phase: Extract<
    TeacherFeedbackWorkspace["submission"]["release"]["snapshot"]["content"],
    { schemaVersion: 2 }
  >["phases"][number] | null;
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
        <div>
          <span className={styles.revisionIndex}>
            {String(revision.revisionNumber).padStart(2, "0")}
          </span>
          <div>
            <h3 id={`submission-revision-${revision.id}`}>
              第 {revision.revisionNumber} 版正式提交
            </h3>
            <LocalizedDateTime dateTime={revision.submittedAt} />
          </div>
        </div>
        <div className={styles.revisionBadges}>
          {current ? <span>当前正式版</span> : null}
          <span data-late={revision.isLate ? "true" : "false"}>
            {revision.isLate ? "迟交" : "期限内"}
          </span>
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
              <li key={evidenceIndex}>
                <strong>已确认：{evidence.description}</strong>
                <span>{evidenceTypeLabel(evidence.type)}</span>
              </li>
            ) : null;
          })}
        </ul>
      ) : null}
      {revision.attachments.length > 0 ? (
        <ul className={styles.formalAttachmentList}>
          {revision.attachments.map((attachment) => (
            <li key={attachment.id}>
              <a
                href={`/attachments/${attachment.id}/download`}
                download={attachment.filename}
              >
                {attachment.filename}
              </a>
              <span>{Math.ceil(attachment.byteSize / 1024)} KB</span>
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
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  let workspace: TeacherFeedbackWorkspace;

  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    workspace = await getTeacherFeedbackWorkspace(database, context, {
      submissionId,
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
    content.schemaVersion === 2 && submission.phaseIndex > 0
      ? (content.phases[submission.phaseIndex - 1] ?? null)
      : null;
  const revisions = [...submission.revisions].reverse();
  const earlierRevisions = revisions.filter(
    (revision) => revision.id !== currentRevision.id,
  );
  const feedbackStatus = latestFeedbackRevision
    ? latestFeedbackRevision.nextStep && latestFeedbackRevision.supportLevel
      ? `已确认 v${latestFeedbackRevision.version} · ${teacherFeedbackNextStepLabels[latestFeedbackRevision.nextStep]}`
      : `已确认 v${latestFeedbackRevision.version}`
    : "尚无反馈";
  const evaluationStatus =
    content.schemaVersion !== 2
      ? "旧版任务书无量规"
      : latestEvaluationRevision
        ? `已确认 v${latestEvaluationRevision.version}`
        : "尚无评价";

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
          href: `/teacher/releases/${submission.release.id}/submissions`,
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
            <header className={styles.paneHeading}>
              <p className={styles.eyebrow}>学生证据</p>
              <h1 id="submission-student-title">
                {group?.name ?? student.displayName}
              </h1>
              <p className={styles.contextLine}>
                {content.title} · {submission.release.classroom.name}
                {submission.phaseName
                  ? ` · 第 ${submission.phaseIndex} 阶段 · ${submission.phaseName}`
                  : " · 整项提交"}
                {" · "}
                正式修订 {submission.latestRevisionNumber} 版
                {" · "}
                {submission.release.dueAt ? (
                  <>
                    <LocalizedDateTime dateTime={submission.release.dueAt} /> 截止
                  </>
                ) : (
                  "未设置截止"
                )}
              </p>
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
            <header className={styles.historyHeading}>
              <div>
                <h2 id="submission-evidence-title">
                  第 {currentRevision.revisionNumber} 版正式提交
                </h2>
              </div>
              <span>
                {currentRevision.isLate ? "迟交" : "期限内"}
                {revisions.length > 1
                  ? ` · 共 ${revisions.length} 版`
                  : null}
              </span>
            </header>
            {phase ? (
              <p className={styles.phaseContext}>
                {phase.action} · 评价要点：{phase.evaluationFocus}
              </p>
            ) : null}
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
          <dl className={styles.statusLine}>
              <div>
                <dt>形成性反馈</dt>
                <dd>{feedbackStatus}</dd>
              </div>
              <div>
                <dt>量规评价</dt>
                <dd>{evaluationStatus}</dd>
              </div>
            </dl>
            <details className={styles.historyDisclosure}>
              <summary>已确认记录</summary>
              <FeedbackHistory revision={currentRevision} />
              {content.schemaVersion === 2 ? (
                <EvaluationHistory revision={currentRevision} />
              ) : null}
            </details>
            <FeedbackComposer
              key={`${currentRevision.id}:${currentRevision.feedback?.currentVersion ?? 0}`}
              submissionId={submission.id}
              submissionRevisionId={currentRevision.id}
              submissionRevisionNumber={currentRevision.revisionNumber}
              expectedFeedbackVersion={
                currentRevision.feedback?.currentVersion ?? 0
              }
              initialBody={latestFeedbackRevision?.body ?? ""}
              prepareIdempotencySeed={`prepare_teacher_feedback_${randomUUID()}`}
              assistantEnabled={assistantEnabled}
            />
            {content.schemaVersion === 2 ? (
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
            ) : (
              <div className={styles.railNote} role="note">
                <p className={styles.eyebrow}>量规评价</p>
                <p>
                  该活动使用旧版任务书，未包含量规，无法进行量规评价；形成性反馈仍可正常撰写。
                </p>
              </div>
            )}
      </FeedbackWorkspacePanes>
    </TeacherPage>
  );
}
