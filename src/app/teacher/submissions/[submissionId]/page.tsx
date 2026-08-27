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
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  FeedbackWorkspaceQueryError,
  getTeacherFeedbackWorkspace,
  type TeacherFeedbackWorkspace,
} from "../../../../server/queries/feedback-workspace";
import { FeedbackComposer } from "./feedback-composer";
import { EvaluationComposer } from "./evaluation-composer";
import { TeacherAccessGate, TeacherPage } from "../../_components/teacher-shell";
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
        <div>
          <p className={styles.eyebrow}>已确认历史</p>
          <h4 id={`feedback-history-${revision.id}`}>教师反馈</h4>
        </div>
        <span>
          {feedback ? `当前版本 ${feedback.currentVersion}` : "尚无反馈"}
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
                    : "教师手写"}
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
                  旧反馈未指定结构化下一步与支架
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
          这版正式提交尚未创建教师反馈。
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
        <div>
          <p className={styles.eyebrow}>已确认历史</p>
          <h4 id={`evaluation-history-${revision.id}`}>量规评价</h4>
        </div>
        <span>
          {evaluation ? `当前版本 ${evaluation.currentVersion}` : "尚无评价"}
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
                    : "教师手写"}
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
          这版正式提交尚未创建量规评价。
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
      aria-labelledby={`submission-revision-${revision.id}`}
    >
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

      <p className={styles.formalLabel}>正式修订 · 内容不可覆盖</p>
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
              <a href={`/attachments/${attachment.id}/download`}>
                {attachment.filename}
              </a>
              <span>{Math.ceil(attachment.byteSize / 1024)} KB</span>
            </li>
          ))}
        </ul>
      ) : null}
      <FeedbackHistory revision={revision} />
      <EvaluationHistory revision={revision} />
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
  const phase =
    content.schemaVersion === 2 && submission.phaseIndex > 0
      ? (content.phases[submission.phaseIndex - 1] ?? null)
      : null;
  const revisions = [...submission.revisions].reverse();

  return (
    <TeacherPage
      actorName={workspace.actor.displayName}
      breadcrumb={`教师工作台 › 评阅名册 › ${group?.name ?? student.displayName}`}
    >
      <div>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>提交 / 教师反馈</p>
            <h1>{group?.name ?? student.displayName}</h1>
            <p>
              {content.title} · {submission.release.classroom.name}
              {submission.phaseName ? ` · ${submission.phaseName}` : ""}
            </p>
          </div>
          <span className={styles.workspaceStatus}>
            <i aria-hidden="true" />
            手写反馈可用
          </span>
        </header>

        <dl className={styles.contextFacts}>
          <div>
            <dt>活动</dt>
            <dd>{content.title}</dd>
          </div>
          <div>
            <dt>班级</dt>
            <dd>{submission.release.classroom.name}</dd>
          </div>
          <div>
            <dt>提交主体</dt>
            <dd>{group ? `${group.name} · 小组共享` : student.displayName}</dd>
          </div>
          <div>
            <dt>提交范围</dt>
            <dd>
              {submission.phaseName
                ? `第 ${submission.phaseIndex} 阶段 · ${submission.phaseName}`
                : "整项提交"}
            </dd>
          </div>
          <div>
            <dt>截止时间</dt>
            <dd>
              {submission.release.dueAt ? (
                <LocalizedDateTime dateTime={submission.release.dueAt} />
              ) : (
                "未设置"
              )}
            </dd>
          </div>
          <div>
            <dt>正式修订</dt>
            <dd>{submission.latestRevisionNumber} 版</dd>
          </div>
        </dl>

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
          <section className={styles.railNote}>
            <p className={styles.eyebrow}>冻结阶段要求</p>
            <p>
              {phase.action} · 评价要点：{phase.evaluationFocus}
            </p>
          </section>
        ) : null}

        <div className={styles.workspaceGrid}>
          <section
            className={styles.submissionHistory}
            aria-labelledby="submission-history-title"
          >
            <header className={styles.historyHeading}>
              <div>
                <p className={styles.eyebrow}>学生证据</p>
                <h2 id="submission-history-title">正式修订、反馈与评价历史</h2>
              </div>
              <span>{revisions.length} 版 · 新版在前</span>
            </header>
            <div className={styles.revisionList}>
              {revisions.map((revision) => (
                <SubmissionRevision
                  key={revision.id}
                  revision={revision}
                  current={revision.id === currentRevision.id}
                  phase={phase}
                />
              ))}
            </div>
          </section>

          <aside className={styles.feedbackRail}>
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
              />
            ) : (
              <div className={styles.railNote} role="note">
                <p className={styles.eyebrow}>量规评价</p>
                <p>
                  这份发布快照是 schema v1，没有四档量规，因此不开放证据绑定评价。形成性反馈仍可手写确认。
                </p>
              </div>
            )}
            <div className={styles.railNote} role="note">
              <p className={styles.eyebrow}>保存规则</p>
              <p>
                每次修改都新增不可变反馈或量规评价版本。AI 服务停用时，手写与确认流程仍完整可用。
              </p>
            </div>
          </aside>
        </div>
      </div>
    </TeacherPage>
  );
}
