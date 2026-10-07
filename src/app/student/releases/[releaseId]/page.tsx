import { randomUUID } from "node:crypto";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import {
  evidenceTypeLabel,
  isStructuredContent,
  type ActivityTaskPhase,
} from "../../../../domain/activity/activity-content";
import { isFinalSubmission } from "../../../../domain/submission/sequential-execution";
import { currentAudienceProgress } from "../../../../domain/insights/teacher-insights";
import {
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
import {
  CalendarClockIcon,
  CheckIcon,
  FootprintsIcon,
  HourglassIcon,
  LightbulbIcon,
  LockIcon,
  PackageCheckIcon,
  TargetIcon,
} from "lucide-react";
import { styles } from "./submission-ui";
import { parseSupportScaffold } from "../../../../domain/activity/support-scaffold";
import { TaskBookV3View } from "../../../_components/task-book-v3-view";

const studentNavigation = [
  { href: "/student", label: "我的活动" },
] as const;

function ReleaseBrief({
  snapshot,
  includeBackground,
}: {
  snapshot: StudentReleaseWorkspace["release"]["snapshot"];
  includeBackground: boolean;
}) {
  const { content } = snapshot;
  return (
    <details className={styles.releaseBrief}>
      <summary className={styles.briefHeading}>
        <span>
          {includeBackground ? "活动背景与完整任务书" : "完整任务书"}
        </span>
        <span className={styles.briefVersion}>所有阶段与评价标准</span>
      </summary>
      <div className={styles.briefBody}>
        {includeBackground && isStructuredContent(content) ? (
          <section><h3>活动背景</h3><p>{content.backgroundSetting}</p></section>
        ) : null}
        {content.schemaVersion === 2 ? <>
          <section><h3>总体任务</h3><p>{content.taskInstructions}</p></section>
          <section><h3>任务链</h3><ol>{content.phases.map((phase) => <li key={phase.name}><strong>{phase.name}</strong><br />任务：{phase.action}<br />情境：{phase.context}<br />学习支持：{phase.support}<br />需提交：{phase.evidence.map((evidence) => `${evidenceTypeLabel(evidence.type)}：${evidence.description}`).join("；")}<br />评价要点：{phase.evaluationFocus}</li>)}</ol></section>
          <section><h3>评价标准</h3><ul>{content.rubricDimensions.map((dimension) => <li key={dimension.name}><strong>{dimension.name}</strong><br />优秀：{dimension.excellent}<br />良好：{dimension.good}<br />达标：{dimension.pass}<br />需改进：{dimension.improve}</li>)}</ul></section>
        </> : content.schemaVersion === 3 ? <TaskBookV3View content={content} showBackground={false} /> : <>
          <section><h3>任务说明</h3><p>{content.taskInstructions}</p></section>
          <section><h3>学习目标</h3><ol>{content.learningObjectives.map((objective) => <li key={objective}>{objective}</li>)}</ol></section>
          <section><h3>提交证据</h3><ul>{content.evidenceRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul></section>
          <section><h3>教师反馈将关注</h3><ul>{content.feedbackCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></section>
        </>}
      </div>
    </details>
  );
}

// 背景设定是整个故事的开头：第一次进入（第 1 阶段或整项提交）时常驻，
// 学生不会没头没尾地从任务读起；到了后面的阶段它已经读过，收进任务书折叠里，
// 把首屏留给当前要做的事。三维目标、任务设置、跨学科概念、快照摘要是教学设计
// 与审计用的，学生端不展示。
function ActivityBackground({
  snapshot,
}: {
  snapshot: StudentReleaseWorkspace["release"]["snapshot"];
}) {
  const { content } = snapshot;
  if (!isStructuredContent(content)) {
    return null;
  }
  return (
    <section className={styles.activityBackground} aria-label="活动背景">
      <p className={styles.eyebrow}>活动背景</p>
      <p>{content.backgroundSetting}</p>
    </section>
  );
}

type FormalRevision = NonNullable<
  StudentReleaseWorkspace["submission"]
>["revisions"][number];
type QueriedRevision =
  StudentFeedbackWorkspace["submission"]["revisions"][number];

function RevisionContent({
  revision,
  phase,
}: {
  revision: FormalRevision;
  phase: ActivityTaskPhase | null;
}) {
  return (
    <>
      {revision.textEvidence ? (
        <div className={styles.revisionText}>{revision.textEvidence}</div>
      ) : null}
      {phase && revision.completedEvidenceIndexes.length > 0 ? (
        <ul className={styles.completedCheckpoints}>
          {revision.completedEvidenceIndexes.map((evidenceIndex) => {
            const evidence = phase.evidence[evidenceIndex - 1];
            return evidence ? (
              <li key={evidenceIndex}>已完成：{evidence.description}</li>
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
    </>
  );
}

/** 学生只需要老师现在怎么说：当前版本的反馈正文，不带版本号和来源。 */
function FeedbackText({
  feedback,
}: {
  feedback: NonNullable<QueriedRevision["feedback"]>;
}) {
  const current =
    feedback.revisions.find(
      (entry) => entry.version === feedback.currentVersion,
    ) ?? feedback.revisions.at(-1);
  return current ? (
    <div className={styles.feedbackBody}>{current.body}</div>
  ) : null;
}

function EvaluationResult({
  evaluation,
}: {
  evaluation: NonNullable<QueriedRevision["evaluation"]>;
}) {
  const current =
    evaluation.revisions.find(
      (entry) => entry.version === evaluation.currentVersion,
    ) ?? evaluation.revisions.at(-1);
  if (!current) return null;
  return (
    <div className="flex flex-col gap-3">
      <ul className={styles.evaluationOutcomeList}>
        {current.outcomes.map((outcome) => (
          <li key={outcome.dimensionIndex}>
            <strong>{outcome.dimensionName}</strong>
            <span>
              {outcome.status === "LEVEL" && "level" in outcome
                ? teacherEvaluationLevelLabels[outcome.level]
                : teacherEvaluationOutcomeStatusLabels.INSUFFICIENT_EVIDENCE}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.feedbackBody}>{current.summary}</div>
    </div>
  );
}

function queriedRevisionFor(
  revision: FormalRevision,
  feedbackWorkspace: StudentFeedbackWorkspace | null,
): QueriedRevision | null {
  const queried = feedbackWorkspace?.submission.revisions.find(
    (item) => item.id === revision.id,
  );
  return queried?.revisionNumber === revision.revisionNumber ? queried : null;
}

/**
 * 老师对当前这一版说了什么，放在页面最上面：学生回到这一页，最先要知道的
 * 就是「老师怎么说、我接下来做什么」。还没反馈时，只说一句在等。
 */
function TeacherResponse({
  submission,
  feedbackWorkspace,
  phase,
  finalSubmission,
  nextPhaseHref,
  nextPhaseLabel,
}: {
  submission: StudentReleaseWorkspace["submission"];
  feedbackWorkspace: StudentFeedbackWorkspace | null;
  phase: ActivityTaskPhase | null;
  finalSubmission: boolean;
  nextPhaseHref: string | null;
  nextPhaseLabel: string | null;
}) {
  const latest = submission?.revisions.at(-1);
  if (!submission || !latest) return null;
  const queried = queriedRevisionFor(latest, feedbackWorkspace);
  const feedback = queried?.feedback ?? null;
  const evaluation = queried?.evaluation ?? null;
  const currentFeedback = feedback
    ? (feedback.revisions.find(
        (entry) => entry.version === feedback.currentVersion,
      ) ?? feedback.revisions.at(-1))
    : null;
  const nextStep = currentFeedback?.nextStep ?? null;
  const resubmitting = submission.workingCopy !== null;

  return (
    <section
      aria-labelledby="teacher-response-title"
      className={styles.teacherResponse}
      data-next-step={nextStep ?? "NONE"}
    >
      <div className={styles.teacherResponseHeading}>
        <span aria-hidden="true" data-avatar="">
          {feedback ? (
            Array.from(feedback.teacher.displayName)[0]
          ) : (
            <HourglassIcon className="size-4" />
          )}
        </span>
        <h2 id="teacher-response-title">
          {feedback ? `${feedback.teacher.displayName}的反馈` : "已提交，等老师反馈"}
        </h2>
        {nextStep === "REVISE" ? (
          <StatusBadge tone="resubmit">
            {resubmitting ? "修改中" : "需要修改"}
          </StatusBadge>
        ) : nextStep === "CONTINUE" ? (
          <StatusBadge tone="done">{finalSubmission ? "已完成" : "通过"}</StatusBadge>
        ) : !feedback ? (
          <StatusBadge tone="pending">等待反馈</StatusBadge>
        ) : null}
        <span>
          第 {latest.revisionNumber} 版 ·{" "}
          <LocalizedDateTime dateTime={latest.submittedAt} />
          {latest.isLate ? " · 迟交" : ""}
        </span>
      </div>

      {feedback ? <FeedbackText feedback={feedback} /> : null}

      {nextStep === "REVISE" ? (
        <p className={styles.nextStepLine}>
          {resubmitting
            ? "你正在按这条反馈修改，改好后再提交。"
            : "老师希望你按这条反馈修改后，再交一版。"}
        </p>
      ) : nextStep === "CONTINUE" ? (
        finalSubmission ? (
          <p className={styles.nextStepLine}>
            这项活动已经完成。活动关闭前，你仍可以再交一版改进。
          </p>
        ) : nextPhaseHref ? (
          <p className={styles.nextStepLine}>
            这一阶段可以了。
            <Link href={nextPhaseHref}>去{nextPhaseLabel} →</Link>
          </p>
        ) : null
      ) : null}

      {evaluation ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-sm font-semibold">评价</h3>
          <EvaluationResult evaluation={evaluation} />
        </div>
      ) : null}

      <details className={styles.inlineDisclosure}>
        <summary>我提交的内容</summary>
        <div className="flex flex-col gap-3 pt-3">
          <RevisionContent revision={latest} phase={phase} />
        </div>
      </details>
    </section>
  );
}

function EarlierVersions({
  submission,
  feedbackWorkspace,
  phase,
}: {
  submission: StudentReleaseWorkspace["submission"];
  feedbackWorkspace: StudentFeedbackWorkspace | null;
  phase: ActivityTaskPhase | null;
}) {
  const earlier = submission ? submission.revisions.slice(0, -1).reverse() : [];
  if (earlier.length === 0) return null;
  return (
    <details className={styles.historyDisclosure}>
      <summary>之前提交的版本（{earlier.length}）</summary>
      <div className={styles.revisionList}>
        {earlier.map((revision) => {
          const queried = queriedRevisionFor(revision, feedbackWorkspace);
          return (
            <article className={styles.revision} key={revision.id}>
              <h3>
                第 {revision.revisionNumber} 版 ·{" "}
                <LocalizedDateTime dateTime={revision.submittedAt} />
                {revision.isLate ? " · 迟交" : ""}
              </h3>
              <RevisionContent revision={revision} phase={phase} />
              {queried?.feedback ? (
                <div className="flex flex-col gap-1">
                  <p className={styles.eyebrow}>老师的反馈</p>
                  <FeedbackText feedback={queried.feedback} />
                </div>
              ) : null}
              {queried?.evaluation ? (
                <div className="flex flex-col gap-1">
                  <p className={styles.eyebrow}>评价</p>
                  <EvaluationResult evaluation={queried.evaluation} />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </details>
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
  if (workspace.execution.version !== 1 || !isStructuredContent(content)) {
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
        const tone =
          submission?.followUp === "AWAITING_RESUBMISSION" ||
          submission?.followUp === "RESUBMISSION_IN_PROGRESS"
            ? "revise"
            : submitted
              ? "done"
              : unlocked
                ? "active"
                : "locked";
        const state =
          submission?.followUp === "AWAITING_RESUBMISSION"
            ? "老师请你修改"
            : submission?.followUp === "RESUBMISSION_IN_PROGRESS"
              ? "修改中"
              : submitted
                ? submission?.hasCurrentFeedback
                  ? "已有反馈"
                  : "已提交"
                : unlocked
                  ? "进行中"
                  : "待解锁";
        const content = (
          <>
            <span aria-hidden="true" data-bubble="">
              {tone === "done" ? (
                <CheckIcon className="size-3.5" />
              ) : tone === "locked" ? (
                <LockIcon className="size-3" />
              ) : entry.phaseIndex === 0 ? (
                "终"
              ) : (
                entry.phaseIndex
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <strong className="truncate">{entry.label}</strong>
              <small>{state}</small>
            </span>
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
            data-tone={tone}
            href={`/student/releases/${workspace.release.id}?phase=${entry.phaseIndex}`}
            key={entry.phaseIndex}
          >
            {content}
          </Link>
        ) : (
          <span data-tone="locked" key={entry.phaseIndex}>
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
  wholeTaskInstructions,
  finalOfMixed,
  checklistShown,
  dueAt,
  isPastDue,
  showLateWarning,
}: {
  phase: ActivityTaskPhase | null;
  phaseIndex: number;
  wholeTaskInstructions: string;
  finalOfMixed: boolean;
  /** The editor below lists what to hand in as a checklist; don't say it twice. */
  checklistShown: boolean;
  dueAt: string | null;
  isPastDue: boolean;
  showLateWarning: boolean;
}) {
  const scaffold = phase ? parseSupportScaffold(phase.support) : null;
  const heading = phase
    ? `第 ${phaseIndex} 阶段 · ${phase.name}`
    : finalOfMixed
      ? "整项终稿"
      : "活动任务";

  return (
    <section className={styles.phaseFocus} aria-label={heading}>
      <div className={styles.phaseFocusHeading}>
        <p>{heading}</p>
        <span data-late={isPastDue ? "true" : undefined}>
          <CalendarClockIcon aria-hidden="true" className="size-3.5" />
          {dueAt ? (
            <>
              截止 <LocalizedDateTime dateTime={dueAt} />
            </>
          ) : (
            "不限截止时间"
          )}
        </span>
      </div>
      {phase ? (
        <>
          {/* 标题就是这一阶段要做的事；情境在下面一句交代「为什么」。 */}
          <h2 className={styles.phaseHeadline}>{phase.action}</h2>
          <p className={styles.phaseStory}>{phase.context}</p>
          {checklistShown ? null : (
            <div className={styles.taskBlock}>
              <p>
                <PackageCheckIcon aria-hidden="true" className="size-4" />
                要交
              </p>
              <ul>
                {phase.evidence.map((evidence) => (
                  <li key={evidence.description}>
                    {evidence.description}
                    <small>{evidenceTypeLabel(evidence.type)}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {scaffold && scaffold.steps.length > 0 ? (
            <div className={styles.stepsBlock}>
              <p>
                <FootprintsIcon aria-hidden="true" className="size-4" />
                分 {scaffold.steps.length} 步做
              </p>
              <ol>
                {scaffold.steps.map((step, index) => (
                  <li key={`${index}-${step}`}>
                    <span aria-hidden="true">{index + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          <div className={styles.criteriaBlock}>
            <p>
              <TargetIcon aria-hidden="true" className="size-4" />
              老师会看
            </p>
            <p>{phase.evaluationFocus}</p>
          </div>
          {/* 按约定写的支架已经拆成上面的步骤和作答区的开头句；只有剩下的
              说明（或旧式整段支架）才收进提示。 */}
          {scaffold && scaffold.notes.length > 0 ? (
            <details
              className={styles.hintDisclosure}
              open={scaffold.steps.length === 0 ? undefined : true}
            >
              <summary>
                <LightbulbIcon aria-hidden="true" className="size-4" />
                {scaffold.steps.length === 0 ? "卡住了？看看提示" : "提示"}
              </summary>
              {scaffold.notes.map((note, index) => (
                <p key={`${index}-${note}`}>{note}</p>
              ))}
            </details>
          ) : null}
        </>
      ) : (
        <>
          <h2 className={styles.phaseHeadline}>
            {finalOfMixed ? "把各阶段的成果整理成一份终稿" : "完成这项活动"}
          </h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {wholeTaskInstructions}
          </p>
        </>
      )}
      {showLateWarning ? (
        <InlineAlert tone="warning">
          截止时间已过，活动仍开放。你仍可以提交，会标记为迟交。
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
    isStructuredContent(content) && selectedPhaseIndex > 0
      ? (content.phases[selectedPhaseIndex - 1] ?? null)
      : null;
  // The story opens the activity; after the first phase it has been read and
  // moves into the task-book fold.
  const showBackground =
    isStructuredContent(content) && selectedPhaseIndex <= 1;
  const finalSubmission = isFinalSubmission(
    workspace.execution.version,
    content,
    selectedPhaseIndex,
  );
  const nextPhaseIndex =
    workspace.execution.version !== 1 || finalSubmission
      ? null
      : selectedPhaseIndex > 0 &&
          selectedPhaseIndex < workspace.execution.phaseCount
        ? selectedPhaseIndex + 1
        : 0;
  const nextPhase =
    nextPhaseIndex === null
      ? null
      : {
          href: `/student/releases/${releaseId}?phase=${nextPhaseIndex}`,
          label:
            nextPhaseIndex === 0
              ? "整项终稿"
              : `第 ${nextPhaseIndex} 阶段`,
        };
  const readOnlyMessage = isActive
    ? "你已不是该班级的当前成员，仍可查看这份活动与自己的提交，但不能再修改。"
    : "活动已结束，内容仍可查看，但不能再修改或提交。";
  // D-094: the header says where this student is, not only that the activity
  // is open — "进行中" beside "这项活动已经完成" read as a contradiction.
  const ownProgress = currentAudienceProgress({
    executionVersion: workspace.execution.version === 1 ? 1 : 0,
    submissionMode: workspace.execution.mode,
    phaseCount: workspace.execution.phaseCount,
    submissions: workspace.submissions.map((item) => ({
      phaseIndex: item.phaseIndex,
      latestRevisionNumber: item.latestRevisionNumber,
      revisionRequested: item.followUp !== null,
    })),
  });
  const statusLabel = !isActive
    ? workspace.release.status === "ARCHIVED"
      ? "已封存 · 只读"
      : "已关闭 · 只读"
    : !canWrite
      ? "历史成员 · 只读"
      : ownProgress.complete
        ? "你已完成"
        : isPastDue
          ? "已过截止 · 可迟交"
          : "活动进行中";
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
        <header className={styles.releaseHeader}>
          <div>
            <h1>{content.title}</h1>
            <p>{content.summary}</p>
          </div>
          <StatusBadge
            tone={
              !isActive || !canWrite
                ? "neutral"
                : ownProgress.complete
                  ? "done"
                  : isPastDue
                    ? "warning"
                    : "success"
            }
          >
            {statusLabel}
          </StatusBadge>
        </header>

        {workspace.group ? (
          <p className={styles.groupNotice} aria-label="作业小组">
            <strong>{workspace.group.name}</strong>
            {workspace.group.members
              .map(
                (member) =>
                  `${member.student.displayName}${
                    member.roleLabel ? `（${member.roleLabel}）` : ""
                  }`,
              )
              .join("、")}
            <span>全组共用一份作答和老师的反馈，别人保存后刷新就能看到。</span>
          </p>
        ) : null}

        {showBackground ? (
          <ActivityBackground snapshot={workspace.release.snapshot} />
        ) : null}

        <PhaseNavigator
          workspace={workspace}
          selectedPhaseIndex={selectedPhaseIndex}
        />

        <div className={styles.workspaceGrid}>
          <div className={styles.workspaceColumn}>
            <TeacherResponse
              submission={selectedSubmission}
              feedbackWorkspace={feedbackWorkspace}
              phase={selectedPhase}
              finalSubmission={finalSubmission}
              nextPhaseHref={nextPhase?.href ?? null}
              nextPhaseLabel={nextPhase?.label ?? null}
            />
            {selectedSubmission?.workingCopy === null &&
            (selectedSubmission?.latestRevisionNumber ?? 0) > 0 ? null : (
              <PhaseFocus
                phase={selectedPhase}
                phaseIndex={selectedPhaseIndex}
                wholeTaskInstructions={content.taskInstructions}
                finalOfMixed={
                  workspace.execution.version === 1 && selectedPhaseIndex === 0
                }
                checklistShown={canWrite && selectedPhase !== null}
                dueAt={dueAt}
                isPastDue={isPastDue}
                showLateWarning={isPastDue && isActive && canWrite}
              />
            )}
          </div>
          <div className={styles.workColumn}>
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
          </div>
        </div>

        <EarlierVersions
          submission={selectedSubmission}
          feedbackWorkspace={feedbackWorkspace}
          phase={selectedPhase}
        />

        <ReleaseBrief
          snapshot={workspace.release.snapshot}
          includeBackground={!showBackground}
        />
      </div>
    </WorkspaceShell>
  );
}
