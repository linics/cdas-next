import { randomUUID } from "node:crypto";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import {
  evidenceTypeLabel,
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
import { AttachmentPreview } from "../../../_components/attachment-preview";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { InlineAlert, StatusBadge } from "../../../_components/ui";
import { WorkspaceShell } from "../../../_components/workspace-shell";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { attachmentUploadStrategy } from "../../../../server/attachments/attachment-storage-factory";
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
import { SubmissionEditor } from "./submission-editor";
import { StudentAccessGate } from "../../_components/student-shell";
import styles from "./submission-workspace.module.css";
import { TaskBookV3View } from "../../../_components/task-book-v3-view";

const studentNavigation = [
  { href: "/student", label: "我的活动" },
] as const;

function ReleaseBrief({
  snapshot,
}: {
  snapshot: StudentReleaseWorkspace["release"]["snapshot"];
}) {
  const { content } = snapshot;
  return (
    <details className={styles.releaseBrief}>
      <summary className={styles.briefHeading}>
        <span>查看完整任务书</span>
        <span className={styles.briefVersion}>
          发布快照 · 版本 {snapshot.sourceDraftVersion}
        </span>
      </summary>
      <div className={styles.briefBody}>
        {content.schemaVersion === 2 ? <>
          <section><h3>总体任务</h3><p>{content.taskInstructions}</p></section>
          <section><h3>任务链</h3><ol>{content.phases.map((phase) => <li key={phase.name}><strong>{phase.name}</strong><br />任务：{phase.action}<br />情境：{phase.context}<br />学习支持：{phase.support}<br />需提交：{phase.evidence.map((evidence) => `${evidenceTypeLabel(evidence.type)}：${evidence.description}`).join("；")}<br />评价要点：{phase.evaluationFocus}</li>)}</ol></section>
          <section><h3>评价标准</h3><ul>{content.rubricDimensions.map((dimension) => <li key={dimension.name}><strong>{dimension.name}</strong><br />优秀：{dimension.excellent}<br />良好：{dimension.good}<br />合格：{dimension.pass}<br />需改进：{dimension.improve}</li>)}</ul></section>
        </> : content.schemaVersion === 3 ? <TaskBookV3View content={content} /> : <>
          <section><h3>任务说明</h3><p>{content.taskInstructions}</p></section>
          <section><h3>学习目标</h3><ol>{content.learningObjectives.map((objective) => <li key={objective}>{objective}</li>)}</ol></section>
          <section><h3>提交证据</h3><ul>{content.evidenceRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul></section>
          <section><h3>教师反馈将关注</h3><ul>{content.feedbackCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></section>
        </>}
      </div>
    </details>
  );
}

// 背景设定是整个故事的开头 —— 收进折叠里，学生就直接从「第 3 阶段」读起，
// 没头没尾。所以它常驻，其余（总体任务、任务链、评价标准）留在折叠里。
// 三维目标、任务设置、跨学科概念、快照摘要是教学设计与审计用的，学生端不展示。
function ActivityBackground({
  snapshot,
}: {
  snapshot: StudentReleaseWorkspace["release"]["snapshot"];
}) {
  const { content } = snapshot;
  if (content.schemaVersion !== 2) {
    return null;
  }
  return (
    <section className={styles.activityBackground} aria-label="活动背景">
      <p className={styles.eyebrow}>活动背景</p>
      <p>{content.backgroundSetting}</p>
    </section>
  );
}

function RevisionHistory({
  submission,
  feedbackWorkspace,
  phase,
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
}) {
  const revisions = submission ? [...submission.revisions].reverse() : [];
  const feedbackByRevisionId = new Map(
    feedbackWorkspace?.submission.revisions.map((revision) => [
      revision.id,
      revision,
    ]) ?? [],
  );

  return (
    <section className={styles.historySection} aria-labelledby="history-title">
      <div className={styles.historyHeading}>
        <div>
          <p className={styles.eyebrow}>提交历史</p>
          <h2 id="history-title">我的提交与反馈</h2>
        </div>
        <span>{revisions.length} 版</span>
      </div>

      {revisions.length === 0 ? (
        <p className={styles.emptyHistory}>
          尚无正式提交。未提交的草稿不会显示在历史中。
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
                open={index === 0}
              >
                <summary>
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
                  </div>
                </summary>
                <p className={styles.formalNote}>正式提交 · 不可修改</p>
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
                        <div>
                          <strong>{attachment.filename}</strong>
                          <span>{Math.ceil(attachment.byteSize / 1024)} KB</span>
                        </div>
                        <div className={styles.attachmentActions}>
                          <AttachmentPreview attachment={attachment} />
                          <a
                            href={`/attachments/${attachment.id}/download`}
                            download={attachment.filename}
                          >
                            下载
                          </a>
                        </div>
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
                        {feedback ? feedback.teacher.displayName : "待确认"}
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
                                ? "教师撰写"
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
                              早期反馈未包含下一步与支架信息
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={styles.emptyFeedback}>
                      该版本尚无教师反馈。
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
                        {evaluation ? evaluation.teacher.displayName : "待确认"}
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
                                ? "教师撰写"
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
                      该版本尚无量规评价。
                    </p>
                  )}
                </section>
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
        // 一行一档：只有当前阶段在下方展开详情，其余靠点击切换。
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
  dueAt,
  isPastDue,
  showLateWarning,
}: {
  phase: Extract<
    StudentReleaseWorkspace["release"]["snapshot"]["content"],
    { schemaVersion: 2 }
  >["phases"][number] | null;
  phaseIndex: number;
  dueAt: string | null;
  isPastDue: boolean;
  showLateWarning: boolean;
}) {
  if (!phase) {
    return phaseIndex === 0 ? (
      <section className={styles.phaseFocus} aria-label="整项终稿">
        <p className={styles.eyebrow}>混合提交 / 整项终稿</p>
        <p className={styles.phaseStory}>
          各阶段均已正式提交。请整理最终成果与必要附件，完成整项终稿。
        </p>
      </section>
    ) : null;
  }

  return (
    <section className={styles.phaseFocus} aria-label={`第 ${phaseIndex} 阶段：${phase.name}`}>
      <p className={styles.eyebrow}>
        第 {phaseIndex} 阶段 · {phase.name}
      </p>
      {/* 首句是情境，不是标签 —— 学生先读到自己在这个故事里要干什么。 */}
      <p className={styles.phaseStory}>{phase.context}</p>
      <dl>
        <div><dt>任务内容</dt><dd>{phase.action}</dd></div>
        <div>
          <dt>需提交的证据</dt>
          <dd>
            {phase.evidence
              .map(
                (evidence) =>
                  `${evidenceTypeLabel(evidence.type)}：${evidence.description}`,
              )
              .join("；")}
          </dd>
        </div>
        <div><dt>学习支持</dt><dd>{phase.support}</dd></div>
        <div><dt>评价要点</dt><dd>{phase.evaluationFocus}</dd></div>
      </dl>
      <p className={styles.phaseDue} data-late={isPastDue ? "true" : undefined}>
        {dueAt ? (
          <>
            截止 <LocalizedDateTime dateTime={dueAt} />
          </>
        ) : (
          "未设置截止时间"
        )}
      </p>
      {showLateWarning ? (
        <InlineAlert tone="warning">
          <strong>截止时间已过，活动仍开放。</strong>{" "}
          你仍可保存并正式提交，但新提交会标记为迟交。
        </InlineAlert>
      ) : null}
    </section>
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
      return (
        <StudentAccessGate
          code={error.code}
          returnPath={`/student/releases/${releaseId}`}
        />
      );
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
    ? "你已不是该班级的当前成员，仍可查看这份活动与自己的提交，但不能再修改。"
    : "活动已关闭，草稿与已提交内容仍可查看，但不能再保存或提交。";
  const statusLabel = !isActive
    ? workspace.release.status === "ARCHIVED"
      ? "已封存 · 只读"
      : "已关闭 · 只读"
    : !canWrite
      ? "历史成员 · 只读"
      : isPastDue
        ? "截止已过 · 可迟交"
        : "开放提交";
  // The browser cannot work out how to upload on its own: one backend presigns
  // and is written directly, the other takes the bytes through this app.
  const attachmentUpload = attachmentUploadStrategy();

  return (
    <WorkspaceShell
      audience="学生"
      actorName={workspace.actor.displayName}
      breadcrumb={[
        { href: "/student", label: "我的学习活动" },
        { label: content.title },
      ]}
      navigation={studentNavigation}
    >
      <div className={styles.releasePage}>
        <Link className={styles.backLink} href="/student">← 返回我的活动</Link>
        <header className={styles.releaseHeader}>
          <div>
            <p className={styles.eyebrow}>学习活动 / 阶段证据</p>
            <h1>{content.title}</h1>
            <p>{content.summary}</p>
          </div>
          <StatusBadge tone={!isActive || !canWrite ? "neutral" : isPastDue ? "warning" : "success"}>
            {statusLabel}
          </StatusBadge>
        </header>

        {workspace.group ? (
          <section className={styles.groupNotice} aria-labelledby="student-group-title">
            <div>
              <p className={styles.eyebrow}>作业小组 / 全组共享</p>
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
              全组共用同一份草稿、附件、提交记录和教师反馈；任一成员保存后，其他成员刷新即可看到最新内容。
            </p>
          </section>
        ) : null}

        <ActivityBackground snapshot={workspace.release.snapshot} />
        <ReleaseBrief snapshot={workspace.release.snapshot} />

        <PhaseNavigator
          workspace={workspace}
          selectedPhaseIndex={selectedPhaseIndex}
        />

        <div className={styles.workspaceColumn}>
            <PhaseFocus
              phase={selectedPhase}
              phaseIndex={selectedPhaseIndex}
              dueAt={dueAt}
              isPastDue={isPastDue}
              showLateWarning={isPastDue && isActive && canWrite}
            />
            <SubmissionEditor
              releaseId={releaseId}
              phaseIndex={selectedPhaseIndex}
              phase={selectedPhase}
              submission={selectedSubmission}
              canWrite={canWrite}
              isPastDue={isPastDue}
              attachmentUpload={attachmentUpload}
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
                resubmit: `resubmit_${randomUUID()}`,
              }}
            />
            <RevisionHistory
              submission={selectedSubmission}
              feedbackWorkspace={feedbackWorkspace}
              phase={selectedPhase}
            />
        </div>
      </div>
    </WorkspaceShell>
  );
}
