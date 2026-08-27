import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import { SignInButton, SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import {
  assignmentTypeDetails,
  assignmentSubtypeLabel,
  crossDisciplinaryConcepts,
  disciplineLabel,
  evidenceTypeLabel,
  inquiryDepths,
  submissionModes,
} from "../../../../domain/activity/activity-content";
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
import { InlineAlert, StatusBadge } from "../../../_components/ui";
import { WorkspaceShell } from "../../../_components/workspace-shell";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createAttachmentStorageFromEnvironment } from "../../../../server/attachments/vercel-blob-attachment-storage";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  FeedbackWorkspaceQueryError,
  getStudentFeedbackWorkspace,
  type StudentFeedbackWorkspace,
} from "../../../../server/queries/feedback-workspace";
import {
  getStudentReleaseWorkspace,
  SubmissionWorkspaceQueryError,
  type StudentReleaseWorkspace,
} from "../../../../server/queries/submission-workspace";
import { hasMeaningfulTextEvidence } from "../../../../domain/submission/text-evidence";
import { StartResubmitForm } from "./start-resubmit-form";
import { SubmissionEditor } from "./submission-editor";
import { TaskBookDialog } from "./task-book-dialog";
import styles from "./submission-workspace.module.css";

function AccessUnavailable({
  code,
  releaseId,
}: {
  code: AuthenticationError["code"];
  releaseId: string;
}) {
  const copy =
    code === "AUTH_NOT_CONFIGURED"
      ? {
          eyebrow: "登录服务未配置",
          title: "提交入口当前没有开放",
          detail:
            "系统没有可验证的登录身份，因此不会显示活动内容、草稿或任何可写按钮。配置 Clerk 后再从已登录的学生账号进入。",
        }
      : code === "USER_NOT_PROVISIONED"
        ? {
            eyebrow: "账号尚未创建",
            title: "找不到对应的学生身份",
            detail:
              "当前登录账号尚未关联到 CDAS Next 用户。请由管理者完成账号创建与班级成员设置。",
          }
        : {
            eyebrow: "需要登录",
            title: "先确认学生身份再查看作业",
            detail:
              "未登录时不会显示活动内容、现有草稿或提交入口。请完成登录后重新打开这个关联。",
          };

  return (
    <WorkspaceShell audience="学生">
      <section className={styles.accessGate}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        <div className={styles.accessActions}>
          {code === "UNAUTHENTICATED" ? (
            <SignInButton
              mode="modal"
              fallbackRedirectUrl={`/student/releases/${releaseId}`}
            >
              <button className={styles.signInButton} type="button">
                登录学生账号
              </button>
            </SignInButton>
          ) : code === "USER_NOT_PROVISIONED" ? (
            <SignOutButton redirectUrl={`/student/releases/${releaseId}`}>
              <button className={styles.signInButton} type="button">
                退出当前账号
              </button>
            </SignOutButton>
          ) : null}
          <Link href="/">返回工作台</Link>
        </div>
      </section>
    </WorkspaceShell>
  );
}

function ReleaseBrief({
  snapshot,
}: {
  snapshot: StudentReleaseWorkspace["release"]["snapshot"];
}) {
  const { content } = snapshot;
  return (
    <div className={styles.taskBookBody} aria-labelledby="release-brief-title">
      <div className={styles.briefHeading}>
        <p className={styles.eyebrow}>冻结发布快照</p>
        <h2 id="release-brief-title">全部阶段与评价标准</h2>
        <span>版本 {snapshot.sourceDraftVersion}</span>
      </div>

      {content.schemaVersion === 2 ? <>
        <section><h3>任务设置</h3><p>{content.topic} · {content.schoolStage === "PRIMARY" ? "小学" : "初中"}{content.grade}年级<br />主学科：{disciplineLabel(content.mainDisciplineCode)}；融合学科：{content.integratedDisciplineCodes.map(disciplineLabel).join("、")}<br />{assignmentTypeDetails(content.assignmentType).label}（{assignmentTypeDetails(content.assignmentType).description}）{assignmentSubtypeLabel(content.assignmentType, content.assignmentSubtype) ? ` · ${assignmentSubtypeLabel(content.assignmentType, content.assignmentSubtype)}` : ""} · {inquiryDepths.find((item) => item.code === content.inquiryDepth)?.label} · {submissionModes.find((item) => item.code === content.submissionMode)?.label} · {content.durationWeeks} 周</p></section>
        {content.crossDisciplinaryConceptCodes.length > 0 ? <section><h3>跨学科概念</h3><p>{content.crossDisciplinaryConceptCodes.map((code) => { const concept = crossDisciplinaryConcepts.find((item) => item.code === code)!; return `${concept.label}（${concept.description}）`; }).join("；")}</p></section> : null}
        <section><h3>背景设定</h3><p>{content.backgroundSetting}</p></section>
        <section><h3>学习目标</h3><ol><li>知识与技能：{content.objectiveKnowledge}</li><li>过程与方法：{content.objectiveProcess}</li><li>情感态度：{content.objectiveEmotion}</li></ol></section>
        <section><h3>总体任务</h3><p>{content.taskInstructions}</p></section>
        <section><h3>任务链</h3><ol>{content.phases.map((phase) => <li key={phase.name}><strong>{phase.name}</strong>（建议 {phase.suggestedLessons} 课时）<br />要完成：{phase.action}<br />情境：{phase.context}<br />学习支架：{phase.support}<br />提交：{phase.evidence.map((evidence) => `${evidenceTypeLabel(evidence.type)}：${evidence.description}`).join("；")}<br />评价要点：{phase.evaluationFocus}</li>)}</ol></section>
        <section><h3>评价标准</h3><ul>{content.rubricDimensions.map((dimension) => <li key={dimension.name}><strong>{dimension.name}</strong><br />优秀：{dimension.excellent}<br />良好：{dimension.good}<br />合格：{dimension.pass}<br />需改进：{dimension.improve}</li>)}</ul></section>
      </> : <>
        <section><h3>任务说明</h3><p>{content.taskInstructions}</p></section>
        <section><h3>学习目标</h3><ol>{content.learningObjectives.map((objective) => <li key={objective}>{objective}</li>)}</ol></section>
        <section><h3>提交证据</h3><ul>{content.evidenceRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul></section>
        <section><h3>教师反馈将关注</h3><ul>{content.feedbackCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></section>
      </>}

      <p className={styles.snapshotHash} title={snapshot.contentHash}>
        快照摘要 {snapshot.contentHash.slice(0, 12)}…
      </p>
    </div>
  );
}

function RevisionHistory({
  submission,
  feedbackWorkspace,
  phase,
  canWrite,
  releaseId,
  phaseIndex,
  resubmitIdempotencyKey,
}: {
  submission: StudentReleaseWorkspace["submission"];
  feedbackWorkspace: StudentFeedbackWorkspace | null;
  phase: StudentReleaseWorkspace["release"]["snapshot"]["content"] extends infer Content
    ? Content extends { schemaVersion: 2; phases: infer Phases }
      ? Phases extends ReadonlyArray<infer Phase>
        ? Phase | null
        : null
      : null
    : null;
  canWrite: boolean;
  releaseId: string;
  phaseIndex: number;
  resubmitIdempotencyKey: string;
}) {
  const revisions = submission ? [...submission.revisions].reverse() : [];
  const feedbackByRevisionId = new Map(
    feedbackWorkspace?.submission.revisions.map((revision) => [
      revision.id,
      revision,
    ]) ?? [],
  );
  const showResubmit =
    canWrite && Boolean(submission) && !submission?.workingCopy && revisions.length > 0;

  return (
    <section className={styles.historySection} aria-labelledby="history-title">
      <div className={styles.historyHeading}>
        <div>
          <p className={styles.eyebrow}>提交进度</p>
          <h2 id="history-title">我的提交与反馈</h2>
        </div>
        <span>{revisions.length} 版</span>
      </div>

      {revisions.length === 0 ? (
        <p className={styles.emptyHistory}>
          还没有正式修订。保存的工作草稿不会出现在这份历史中。
        </p>
      ) : (
        <div className={styles.revisionList}>
          {revisions.map((revision, index) => {
            const queriedRevision = feedbackByRevisionId.get(revision.id);
            const feedback =
              queriedRevision?.revisionNumber === revision.revisionNumber
                ? queriedRevision.feedback
                : null;
            const evaluation =
              queriedRevision?.revisionNumber === revision.revisionNumber
                ? queriedRevision.evaluation
                : null;
            const feedbackHeadingId = `feedback-${revision.id}`;
            const evaluationHeadingId = `evaluation-${revision.id}`;

            return (
              <details
                className={styles.revision}
                key={revision.id}
                open={index === 0 ? true : undefined}
              >
                <summary className={styles.revisionSummary}>
                  <div>
                    <span className={styles.revisionNumber}>
                      {String(revision.revisionNumber).padStart(2, "0")}
                    </span>
                    <div>
                      <h3>第 {revision.revisionNumber} 版</h3>
                      <p>
                        <LocalizedDateTime dateTime={revision.submittedAt} />
                      </p>
                    </div>
                  </div>
                  <div className={styles.revisionBadges}>
                    {index === 0 ? <span>当前正式版</span> : null}
                    <span data-late={revision.isLate ? "true" : "false"}>
                      {revision.isLate ? "迟交" : "期限内"}
                    </span>
                    {index === 0 ? null : <span>点击展开</span>}
                  </div>
                </summary>
                <p className={styles.formalNote}>正式修订 · 内容不可覆盖</p>
                {revision.textEvidence ? (
                  <div className={styles.revisionText}>
                    {revision.textEvidence}
                  </div>
                ) : null}
                {phase && revision.completedEvidenceIndexes.length > 0 ? (
                  <ul className={styles.completedCheckpoints}>
                    {revision.completedEvidenceIndexes.map((evidenceIndex) => {
                      const evidence = phase.evidence[evidenceIndex - 1];
                      return evidence ? (
                        <li key={evidenceIndex}>
                          已确认：{evidence.description}（{evidenceTypeLabel(evidence.type)}）
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

                <section
                  className={styles.feedbackSection}
                  aria-labelledby={feedbackHeadingId}
                >
                  <div className={styles.feedbackHeading}>
                    <div>
                      <p className={styles.eyebrow}>教师反馈</p>
                      <h4 id={feedbackHeadingId}>
                        {feedback ? feedback.teacher.displayName : "尚待确认"}
                      </h4>
                    </div>
                    {feedback ? (
                      <span>当前第 {feedback.currentVersion} 版</span>
                    ) : null}
                  </div>

                  {feedback ? (
                    <ol className={styles.feedbackVersions}>
                      {[...feedback.revisions].reverse().map((entry) => (
                        <li
                          className={styles.feedbackVersion}
                          data-current={
                            entry.version === feedback.currentVersion
                              ? "true"
                              : "false"
                          }
                          key={entry.id}
                        >
                          <div className={styles.feedbackVersionMeta}>
                            <strong>反馈第 {entry.version} 版</strong>
                            {entry.version === feedback.currentVersion ? (
                              <span>当前版本</span>
                            ) : null}
                            <p>
                              {feedback.teacher.displayName} · {entry.source ===
                              "MANUAL"
                                ? "教师手写"
                                : "AI 建议，教师已确认"}
                            </p>
                            <LocalizedDateTime dateTime={entry.confirmedAt} />
                          </div>
                          <div className={styles.feedbackBody}>{entry.body}</div>
                          {entry.nextStep && entry.supportLevel ? (
                            <div className={styles.feedbackStructure}>
                              <span>
                                形成性下一步：
                                {teacherFeedbackNextStepLabels[entry.nextStep]}
                              </span>
                              <span>
                                支架层级：
                                {teacherFeedbackSupportLevelLabels[
                                  entry.supportLevel
                                ]}
                              </span>
                            </div>
                          ) : (
                            <p className={styles.legacyFeedbackStructure}>
                              旧反馈未指定结构化下一步与支架
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={styles.emptyFeedback}>
                      此正式修订尚无教师已确认的反馈。
                    </p>
                  )}
                </section>

                <section
                  className={styles.feedbackSection}
                  aria-labelledby={evaluationHeadingId}
                >
                  <div className={styles.feedbackHeading}>
                    <div>
                      <p className={styles.eyebrow}>量规评价</p>
                      <h4 id={evaluationHeadingId}>
                        {evaluation ? evaluation.teacher.displayName : "尚待确认"}
                      </h4>
                    </div>
                    {evaluation ? (
                      <span>当前第 {evaluation.currentVersion} 版</span>
                    ) : null}
                  </div>

                  {evaluation ? (
                    <ol className={styles.feedbackVersions}>
                      {[...evaluation.revisions].reverse().map((entry) => (
                        <li
                          className={styles.feedbackVersion}
                          data-current={
                            entry.version === evaluation.currentVersion
                              ? "true"
                              : "false"
                          }
                          key={entry.id}
                        >
                          <div className={styles.feedbackVersionMeta}>
                            <strong>评价第 {entry.version} 版</strong>
                            {entry.version === evaluation.currentVersion ? (
                              <span>当前版本</span>
                            ) : null}
                            <p>
                              {evaluation.teacher.displayName} · {entry.source ===
                              "MANUAL"
                                ? "教师手写"
                                : "AI 建议，教师已确认"}
                            </p>
                            <LocalizedDateTime dateTime={entry.confirmedAt} />
                          </div>
                          <div>
                            <ul className={styles.evaluationOutcomeList}>
                              {entry.outcomes.map((outcome) => (
                                <li key={outcome.dimensionIndex}>
                                  <strong>
                                    {outcome.dimensionIndex}. {outcome.dimensionName}
                                  </strong>
                                  <span>
                                    {outcome.status === "LEVEL" &&
                                    "level" in outcome
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
                                                (item) =>
                                                  item.id === citation.attachmentId,
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
                              {entry.summary}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={styles.emptyFeedback}>
                      此正式修订尚无教师已确认的量规评价。
                    </p>
                  )}
                </section>
                {index === 0 && showResubmit ? (
                  <StartResubmitForm
                    idempotencyKey={resubmitIdempotencyKey}
                    latestRevisionNumber={revision.revisionNumber}
                    layout="inline"
                    phaseIndex={phaseIndex}
                    releaseId={releaseId}
                  />
                ) : null}
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PhaseNavigator({
  workspace,
  selectedPhaseIndex,
}: {
  workspace: StudentReleaseWorkspace;
  selectedPhaseIndex: number;
}) {
  const content = workspace.release.snapshot.content;
  if (workspace.execution.version !== 1 || content.schemaVersion !== 2) {
    return null;
  }

  const byPhase = new Map(
    workspace.submissions.map((submission) => [
      submission.phaseIndex,
      submission,
    ]),
  );
  const entries = content.phases.map((phase, index) => ({
    phaseIndex: index + 1,
    label: phase.name,
  }));
  if (workspace.execution.mode === "mixed") {
    entries.push({ phaseIndex: 0, label: "整项终稿" });
  }

  return (
    <nav className={styles.phaseNavigator} aria-label="任务阶段">
      {entries.map((entry) => {
        const submission = byPhase.get(entry.phaseIndex);
        const submitted = (submission?.latestRevisionNumber ?? 0) > 0;
        const unlocked =
          entry.phaseIndex === workspace.execution.currentPhaseIndex ||
          submission !== undefined ||
          (entry.phaseIndex > 0 &&
            entry.phaseIndex < workspace.execution.currentPhaseIndex);
        const state = submitted
          ? "已提交"
          : unlocked
            ? "进行中"
            : "待解锁";
        const content = (
          <>
            <span>{entry.phaseIndex === 0 ? "终" : entry.phaseIndex}</span>
            <strong>{entry.label}</strong>
            <small>{state}</small>
          </>
        );
        return unlocked ? (
          <Link
            aria-current={
              entry.phaseIndex === selectedPhaseIndex ? "step" : undefined
            }
            data-current={
              entry.phaseIndex === selectedPhaseIndex ? "true" : "false"
            }
            href={`/student/releases/${workspace.release.id}?phase=${entry.phaseIndex}`}
            key={entry.phaseIndex}
          >
            {content}
          </Link>
        ) : (
          <span data-locked="true" key={entry.phaseIndex}>
            {content}
          </span>
        );
      })}
    </nav>
  );
}

function PhaseFocus({
  phase,
  phaseIndex,
  isMixedCapstone,
  narrative,
  dueLabel,
  isPastDue,
  primaryAction,
  taskBook,
}: {
  phase: Extract<
    StudentReleaseWorkspace["release"]["snapshot"]["content"],
    { schemaVersion: 2 }
  >["phases"][number] | null;
  phaseIndex: number;
  isMixedCapstone: boolean;
  narrative: string | null;
  dueLabel: ReactNode;
  isPastDue: boolean;
  primaryAction: ReactNode;
  taskBook: ReactNode;
}) {
  if (isMixedCapstone) {
    return (
      <section className={styles.phaseFocus}>
        <p className={styles.eyebrow}>整项终稿</p>
        <h2>汇总全部阶段成果</h2>
        <p>所有阶段已经正式提交。现在整理跨阶段说明、最终成果和必要附件。</p>
        <dl>
          <div>
            <dt>截止时间</dt>
            <dd>
              {dueLabel}
              {isPastDue ? " · 已过截止，提交会标为迟交" : ""}
            </dd>
          </div>
        </dl>
        <div className={styles.stageActions}>
          {primaryAction}
          {taskBook}
        </div>
      </section>
    );
  }

  if (!phase) {
    return (
      <section className={styles.phaseFocus}>
        <p className={styles.eyebrow}>当前任务</p>
        <h2>现在要完成的事</h2>
        {narrative ? <p>{narrative}</p> : null}
        <dl>
          <div>
            <dt>截止时间</dt>
            <dd>
              {dueLabel}
              {isPastDue ? " · 已过截止，提交会标为迟交" : ""}
            </dd>
          </div>
        </dl>
        <div className={styles.stageActions}>
          {primaryAction}
          {taskBook}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.phaseFocus}>
      <p className={styles.eyebrow}>第 {phaseIndex} 阶段</p>
      <h2>{phase.name}</h2>
      <p>{phase.context}</p>
      <dl>
        <div>
          <dt>这一步做什么</dt>
          <dd>{phase.action}</dd>
        </div>
        <div>
          <dt>可以怎么做</dt>
          <dd>{phase.support}</dd>
        </div>
        <div>
          <dt>老师会看什么</dt>
          <dd>{phase.evaluationFocus}</dd>
        </div>
        <div>
          <dt>需要交什么</dt>
          <dd>
            {phase.evidence
              .map(
                (evidence) =>
                  `${evidenceTypeLabel(evidence.type)}：${evidence.description}`,
              )
              .join("；")}
          </dd>
        </div>
        <div>
          <dt>截止时间</dt>
          <dd>
            {dueLabel}
            {isPastDue ? " · 已过截止，提交会标为迟交" : ""}
          </dd>
        </div>
      </dl>
      <div className={styles.stageActions}>
        {primaryAction}
        {taskBook}
      </div>
    </section>
  );
}

function StagePrimaryAction({
  canWrite,
  workingCopy,
  latestRevisionNumber,
  releaseId,
  phaseIndex,
  resubmitIdempotencyKey,
}: {
  canWrite: boolean;
  workingCopy: NonNullable<StudentReleaseWorkspace["submission"]>["workingCopy"];
  latestRevisionNumber: number;
  releaseId: string;
  phaseIndex: number;
  resubmitIdempotencyKey: string;
}) {
  if (!canWrite) {
    return null;
  }
  if (workingCopy) {
    const hasSavedEvidence =
      hasMeaningfulTextEvidence(workingCopy.textEvidence) ||
      workingCopy.completedEvidenceIndexes.length > 0 ||
      workingCopy.attachments.some((attachment) => attachment.status === "READY");
    return (
      <a
        className={styles.secondaryButton}
        href={hasSavedEvidence ? "#submission-commit" : "#submission-workspace"}
      >
        {hasSavedEvidence ? "提交正式版" : "继续编辑草稿"}
      </a>
    );
  }
  if (latestRevisionNumber > 0) {
    return (
      <StartResubmitForm
        idempotencyKey={resubmitIdempotencyKey}
        latestRevisionNumber={latestRevisionNumber}
        phaseIndex={phaseIndex}
        releaseId={releaseId}
      />
    );
  }
  return (
    <a className={styles.secondaryButton} href="#submission-workspace">
      开始完成任务
    </a>
  );
}

export default async function StudentReleasePage({
  params,
  searchParams,
}: {
  params: Promise<{ releaseId: string }>;
  searchParams?: Promise<{ phase?: string | string[] }>;
}) {
  // Teacher feedback/evaluation saves invalidate this route, but Preview can
  // still serve a stale RSC payload unless the page is request-bound.
  await connection();
  const { releaseId } = await params;
  const requestedPhaseValue = searchParams
    ? (await searchParams).phase
    : undefined;
  let context;
  let workspace: StudentReleaseWorkspace;
  let selectedSubmission: StudentReleaseWorkspace["submission"] = null;
  let selectedPhaseIndex = 0;
  let feedbackWorkspace: StudentFeedbackWorkspace | null = null;

  try {
    context = await createUiCommandContext();
    const database = getDatabaseClient();
    workspace = await getStudentReleaseWorkspace(database, context, {
      releaseId,
    });
    const requestedPhase =
      typeof requestedPhaseValue === "string" &&
      /^\d+$/.test(requestedPhaseValue)
        ? Number(requestedPhaseValue)
        : workspace.execution.currentPhaseIndex;
    const requestedSubmission = workspace.submissions.find(
      (submission) => submission.phaseIndex === requestedPhase,
    );
    const requestedUnlocked =
      workspace.execution.version === 0
        ? requestedPhase === 0
        : requestedPhase === workspace.execution.currentPhaseIndex ||
          requestedSubmission !== undefined ||
          (requestedPhase > 0 &&
            requestedPhase < workspace.execution.currentPhaseIndex);
    selectedPhaseIndex = requestedUnlocked
      ? requestedPhase
      : workspace.execution.currentPhaseIndex;
    selectedSubmission =
      workspace.submissions.find(
        (submission) => submission.phaseIndex === selectedPhaseIndex,
      ) ?? null;

    if (selectedSubmission) {
      feedbackWorkspace = await getStudentFeedbackWorkspace(
        database,
        context,
        { submissionId: selectedSubmission.id },
      );
      if (
        feedbackWorkspace.submission.id !== selectedSubmission.id ||
        feedbackWorkspace.submission.release.id !== releaseId
      ) {
        throw new FeedbackWorkspaceQueryError("NOT_FOUND");
      }
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <AccessUnavailable code={error.code} releaseId={releaseId} />;
    }
    if (
      error instanceof FeedbackWorkspaceQueryError ||
      error instanceof SubmissionWorkspaceQueryError ||
      error instanceof ZodError
    ) {
      notFound();
    }
    throw error;
  }

  const observedAt = context.clock();
  const dueAt = workspace.release.dueAt;
  const isPastDue = dueAt !== null && observedAt > new Date(dueAt);
  const isActive = workspace.release.status === "ACTIVE";
  const canWrite = workspace.access.canWrite;
  const content = workspace.release.snapshot.content;
  const selectedPhase =
    content.schemaVersion === 2 && selectedPhaseIndex > 0
      ? (content.phases[selectedPhaseIndex - 1] ?? null)
      : null;
  const readOnlyMessage = isActive
    ? "你当前保留这份活动与自己提交的唯读权限，但已不是可写的班级成员。"
    : "活动已关闭，现有工作草稿与正式修订仍可查看，但不能再保存或提交。";
  const statusLabel = !isActive
    ? workspace.release.status === "ARCHIVED"
      ? "已封存 · 唯读"
      : "已关闭 · 唯读"
    : !canWrite
      ? "历史成员 · 唯读"
      : isPastDue
        ? "截止已过 · 可迟交"
        : "开放提交";
  const currentSubmission = workspace.submissions.find(
    (submission) =>
      submission.phaseIndex === workspace.execution.currentPhaseIndex,
  );
  const currentSubmissionLabel = workspace.execution.version === 1
    ? workspace.execution.currentPhaseIndex === 0
      ? "阶段已完成 · 正在整理整项终稿"
      : `第 ${workspace.execution.currentPhaseIndex}/${workspace.execution.phaseCount} 阶段`
    : currentSubmission?.workingCopy
    ? currentSubmission.workingCopy.baseRevisionNumber > 0
      ? `第 ${currentSubmission.workingCopy.baseRevisionNumber + 1} 版重交草稿`
      : "未提交草稿"
    : currentSubmission && currentSubmission.latestRevisionNumber > 0
      ? `第 ${currentSubmission.latestRevisionNumber} 版已正式提交`
      : "尚未创建草稿";
  const attachmentStorageEnabled =
    createAttachmentStorageFromEnvironment() !== null;
  const resubmitIdempotencyKey = `resubmit_${randomUUID()}`;
  const isMixedCapstone =
    workspace.execution.version === 1 &&
    selectedPhaseIndex === 0 &&
    content.schemaVersion === 2;
  const taskBook = (
    <TaskBookDialog>
      <ReleaseBrief snapshot={workspace.release.snapshot} />
    </TaskBookDialog>
  );
  const primaryAction = (
    <StagePrimaryAction
      canWrite={canWrite}
      latestRevisionNumber={selectedSubmission?.latestRevisionNumber ?? 0}
      phaseIndex={selectedPhaseIndex}
      releaseId={releaseId}
      resubmitIdempotencyKey={resubmitIdempotencyKey}
      workingCopy={selectedSubmission?.workingCopy ?? null}
    />
  );

  return (
    <WorkspaceShell
      audience="学生"
      actorName={workspace.actor.displayName}
    >
      <div className={styles.releasePage}>
        <Link className={styles.backLink} href="/student">← 返回我的活动</Link>
        <header className={styles.releaseHeader}>
          <div>
            <p className={styles.eyebrow}>当前任务</p>
            <h1>{content.title}</h1>
            <p>{content.summary}</p>
          </div>
          <StatusBadge tone={!isActive || !canWrite ? "neutral" : isPastDue ? "warning" : "success"}>
            {statusLabel}
          </StatusBadge>
        </header>

        <dl className={styles.releaseFacts}>
          <div>
            <dt>截止时间</dt>
            <dd>{dueAt ? <LocalizedDateTime dateTime={dueAt} /> : "未设置"}</dd>
          </div>
          <div>
            <dt>当前进度</dt>
            <dd>{currentSubmissionLabel}</dd>
          </div>
        </dl>

        {workspace.group ? (
          <section className={styles.groupNotice} aria-labelledby="student-group-title">
            <div>
              <p className={styles.eyebrow}>小组共享</p>
              <h2 id="student-group-title">{workspace.group.name}</h2>
            </div>
            <p>
              {workspace.group.members
                .map(
                  (member) =>
                    `${member.student.displayName}${
                      member.roleLabel ? `（${member.roleLabel}）` : ""
                    }`,
                )
                .join("、")}
            </p>
            <p>
              你们使用同一份阶段草稿、附件、正式修订和教师反馈。任一成员保存后，其他成员刷新即可看到最新版本。
            </p>
          </section>
        ) : null}

        {isPastDue && isActive && canWrite ? (
          <div className={styles.lateNotice}>
            <InlineAlert tone="warning">
              <strong>截止时间已过，但活动仍开放。</strong> 你仍可保存并正式提交；新创建的正式修订会永久标记为迟交。
            </InlineAlert>
          </div>
        ) : null}

        <PhaseNavigator
          workspace={workspace}
          selectedPhaseIndex={selectedPhaseIndex}
        />

        <div className={styles.workspaceGrid}>
          <div className={styles.submissionColumn}>
            <PhaseFocus
              dueLabel={dueAt ? <LocalizedDateTime dateTime={dueAt} /> : "未设置"}
              isMixedCapstone={isMixedCapstone}
              isPastDue={isPastDue}
              narrative={selectedPhase ? null : content.taskInstructions}
              phase={selectedPhase}
              phaseIndex={selectedPhaseIndex}
              primaryAction={primaryAction}
              taskBook={taskBook}
            />
            <SubmissionEditor
              releaseId={releaseId}
              phaseIndex={selectedPhaseIndex}
              phase={selectedPhase}
              submission={selectedSubmission}
              canWrite={canWrite}
              isPastDue={isPastDue}
              attachmentStorageEnabled={attachmentStorageEnabled}
              readOnlyMessage={readOnlyMessage}
              workingCopyUpdatedLabel={
                selectedSubmission?.workingCopy
                  ? <LocalizedDateTime
                      dateTime={selectedSubmission.workingCopy.updatedAt}
                    />
                  : null
              }
              idempotencySeeds={{
                save: `save_${randomUUID()}`,
                submit: `submit_${randomUUID()}`,
                resubmit: resubmitIdempotencyKey,
              }}
            />
            <RevisionHistory
              canWrite={canWrite}
              feedbackWorkspace={feedbackWorkspace}
              phase={selectedPhase}
              phaseIndex={selectedPhaseIndex}
              releaseId={releaseId}
              resubmitIdempotencyKey={resubmitIdempotencyKey}
              submission={selectedSubmission}
            />
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
