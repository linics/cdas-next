import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { LocalizedDateTime } from "../../../../_components/localized-date-time";
import { AuthenticationError } from "../../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../../server/db/client";
import {
  getTeacherReleaseSubmissions,
  SubmissionWorkspaceQueryError,
} from "../../../../../server/queries/submission-workspace";
import { shortResourceId } from "../../../_components/format";
import {
  TeacherAccessGate,
  TeacherPage,
  teacherHomeCrumb,
} from "../../../_components/teacher-shell";
import { styles } from "../../../teacher-ui";
import { StatusBadge } from "../../../../_components/ui";
import { CloseActivityPanel } from "./close-activity-panel";
import { ReleaseGroupManager } from "./release-group-manager";
import {
  matchesReviewQueue,
  parseReviewQueueFilter,
  reviewQueueQuery,
  reviewQueueStatuses,
  type ReviewQueueFilter,
} from "../../../../../domain/review/review-queue";
import { reviewQueueItems } from "../../../../../server/queries/review-queue";
import { cn } from "@/lib/utils";
import { stageBucketKeyPattern } from "../../../../../domain/insights/teacher-insights";

const stageLabels: Record<string, string> = {
  not_started: "尚未开始",
  in_progress: "已开始、尚未正式提交",
  final: "正在整理整项终稿",
  complete: "全部完成",
};

function stageLabel(key: string): string {
  return stageLabels[key] ?? `停在第 ${key.replace("phase:", "")} 阶段`;
}

export default async function TeacherReleaseSubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ releaseId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { releaseId } = await params;
  const query = (await searchParams) ?? {};
  const filter = parseReviewQueueFilter(query);
  // Stage drill-down from the insights card (D-070): which students or groups
  // sit in one progress bucket. It narrows the progress list, not the queue.
  const stageParam = typeof query.stage === "string" ? query.stage : "";
  const stage = stageBucketKeyPattern.test(stageParam) ? stageParam : null;
  let workspace;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    workspace = await getTeacherReleaseSubmissions(database, context, {
      releaseId,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <TeacherAccessGate
          code={error.code}
          returnPath={`/teacher/releases/${releaseId}/submissions`}
        />
      );
    }
    if (
      error instanceof SubmissionWorkspaceQueryError ||
      error instanceof ZodError
    ) {
      notFound();
    }
    throw error;
  }

  const awaitingResubmissionCount = workspace.submissions.filter(
    (submission) => submission.currentRevision.followUp === "AWAITING_RESUBMISSION",
  ).length;
  const queueItems = reviewQueueItems(workspace);
  const evaluationAsked = workspace.reviewCoverage.evaluableCount > 0;
  const countFor = (candidate: ReviewQueueFilter) =>
    queueItems.filter((item) => matchesReviewQueue(item, candidate)).length;
  const visibleIds = new Set(
    queueItems
      .filter((item) => matchesReviewQueue(item, filter))
      .map((item) => item.submissionId),
  );
  const visibleSubmissions = workspace.submissions.filter((submission) =>
    visibleIds.has(submission.submissionId),
  );
  const phaseOptions = [
    ...new Map(
      workspace.submissions.map((submission) => [
        submission.phaseIndex,
        submission.phaseName ?? "整项提交",
      ]),
    ),
  ].sort(([left], [right]) => left - right);
  const visibleProgress = stage
    ? workspace.progress.filter((entry) => entry.stageKey === stage)
    : workspace.progress;
  const dimensionName =
    filter.dimension !== null
      ? (workspace.release.rubricDimensionNames[filter.dimension - 1] ?? null)
      : null;
  const rosterHref = (next: ReviewQueueFilter) =>
    `/teacher/releases/${workspace.release.id}/submissions${reviewQueueQuery(next)}`;
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
      active
        ? "border-primary/40 bg-primary/12 font-medium text-foreground"
        : "text-muted-foreground hover:bg-muted",
    );

  return (
    <TeacherPage
      actorName={workspace.actor.displayName}
      breadcrumb={[
        teacherHomeCrumb,
        {
          href: `/teacher/classrooms/${workspace.release.classroomId}/members`,
          label: workspace.release.classroomName,
        },
        { label: workspace.release.title },
      ]}
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <h1>{workspace.release.title}</h1>
            <p>
              {workspace.release.classroomName} · 发布{" "}
              {shortResourceId(workspace.release.id)} ·{" "}
              <LocalizedDateTime dateTime={workspace.release.publishedAt} />{" "}
              发布
            </p>
          </div>
          <div className={styles.pageHeaderActions}>
            <Link
              className={styles.secondaryButton}
              href={`/print/releases/${workspace.release.id}`}
            >
              打印任务书
            </Link>
            <a
              className={styles.secondaryButton}
              href={`/teacher/releases/${workspace.release.id}/submissions/export`}
            >
              导出评阅名册
            </a>
            <Link className={styles.secondaryButton} href="/teacher">
              ← 返回工作台
            </Link>
          </div>
        </header>

        <section className={styles.submissionPage}>
          <section className={styles.reviewSection} aria-labelledby="review-title">
            <header className={styles.sectionHeader}>
              <div>
                <p className={styles.eyebrow}>评阅</p>
                <h2 id="review-title">学生提交</h2>
              </div>
              <span>
                {workspace.submissions.length} 份
                {workspace.reviewCoverage.currentRevisionCount > 0
                  ? ` · 已反馈 ${workspace.reviewCoverage.feedbackCount}/${workspace.reviewCoverage.currentRevisionCount}`
                  : ""}
                {evaluationAsked
                  ? ` · 终稿已评价 ${workspace.reviewCoverage.evaluationCount}/${workspace.reviewCoverage.evaluableCount}`
                  : ""}
                {awaitingResubmissionCount > 0
                  ? ` · 待重交 ${awaitingResubmissionCount}`
                  : ""}
              </span>
            </header>

            {workspace.submissions.length > 0 ? (
              <nav aria-label="评阅筛选" className="flex flex-col gap-3">
                <div className={styles.statTiles}>
                  {reviewQueueStatuses
                    .filter(
                      (status) =>
                        status.code !== "evaluation" || evaluationAsked,
                    )
                    .map((status) => {
                      const next = { ...filter, status: status.code };
                      const count = countFor(next);
                      return (
                        <Link
                          aria-current={
                            filter.status === status.code ? "true" : undefined
                          }
                          className={styles.statTile}
                          data-tone={
                            status.code === "all"
                              ? "all"
                              : count === 0
                                ? "clear"
                                : status.code === "resubmit"
                                  ? "resubmit"
                                  : "pending"
                          }
                          href={rosterHref(next)}
                          key={status.code}
                        >
                          <span>{status.label}</span>
                          <strong className="tabular-nums">{count}</strong>
                        </Link>
                      );
                    })}
                </div>
                {phaseOptions.length > 1 ? (
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className={chip(filter.phase === null)}
                      href={rosterHref({ ...filter, phase: null })}
                    >
                      全部阶段
                    </Link>
                    {phaseOptions.map(([phaseIndex, phaseName]) => (
                      <Link
                        className={chip(filter.phase === phaseIndex)}
                        href={rosterHref({ ...filter, phase: phaseIndex })}
                        key={phaseIndex}
                      >
                        {phaseIndex > 0 ? `第 ${phaseIndex} 阶段 · ${phaseName}` : phaseName}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </nav>
            ) : null}

            {filter.dimension !== null ? (
              <p className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                只看「{dimensionName ?? `评价维度 ${filter.dimension}`}」当前评价为待改进或证据不足的提交
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={rosterHref({ ...filter, dimension: null })}
                >
                  清除
                </Link>
              </p>
            ) : null}

            {workspace.submissions.length === 0 ? (
              <p className={styles.emptyState}>
                还没有学生提交。学生没提交的草稿不会出现在这里。
              </p>
            ) : visibleSubmissions.length === 0 ? (
              <p className={styles.emptyState}>这一栏已经处理完了。</p>
            ) : (
              <ul className={styles.reviewList}>
                {visibleSubmissions.map((submission) => {
                  const name =
                    submission.group?.name ?? submission.student.displayName;
                  const needsFeedback =
                    submission.currentRevision.feedback === null;
                  const needsEvaluation =
                    submission.evaluationOpen &&
                    submission.currentRevision.evaluation === null;
                  const awaiting =
                    submission.currentRevision.followUp ===
                    "AWAITING_RESUBMISSION";
                  const resubmitting =
                    submission.currentRevision.followUp ===
                    "RESUBMISSION_IN_PROGRESS";
                  const actionable = needsFeedback || needsEvaluation;
                  return (
                    <li className={styles.reviewRow} key={submission.submissionId}>
                      <span
                        aria-hidden="true"
                        className={styles.avatar}
                        data-active={actionable ? "true" : "false"}
                      >
                        {Array.from(name)[0]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={styles.reviewName}>{name}</p>
                        <p className={styles.reviewMeta}>
                          {submission.phaseName
                            ? `第 ${submission.phaseIndex} 阶段 · ${submission.phaseName}`
                            : "整项提交"}
                          {` · 第 ${submission.currentRevision.revisionNumber} 版 · `}
                          <LocalizedDateTime
                            dateTime={submission.currentRevision.submittedAt}
                          />
                          {submission.group
                            ? ` · 小组：${submission.group.members
                                .map((member) => member.student.displayName)
                                .join("、")}`
                            : ` · 学生编号 ${shortResourceId(submission.student.id)}`}
                        </p>
                      </div>
                      <div className={styles.reviewBadges}>
                        {submission.currentRevision.isLate ? (
                          <StatusBadge tone="resubmit">迟交</StatusBadge>
                        ) : null}
                        {needsFeedback ? (
                          <StatusBadge tone="pending">待反馈</StatusBadge>
                        ) : null}
                        {needsEvaluation ? (
                          <StatusBadge tone="pending">待评价</StatusBadge>
                        ) : null}
                        {awaiting ? (
                          <StatusBadge tone="resubmit">待重交</StatusBadge>
                        ) : resubmitting ? (
                          <StatusBadge tone="resubmit">重交中</StatusBadge>
                        ) : null}
                        {!needsFeedback && submission.currentRevision.feedback ? (
                          <StatusBadge tone={actionable || awaiting || resubmitting ? "neutral" : "done"}>
                            {`已反馈 v${submission.currentRevision.feedback.currentVersion}`}
                          </StatusBadge>
                        ) : null}
                        {submission.currentRevision.evaluation ? (
                          <StatusBadge tone="neutral">
                            {`已评价 v${submission.currentRevision.evaluation.currentVersion}`}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <Link
                        className={actionable ? styles.rowAction : styles.rowView}
                        href={`/teacher/submissions/${submission.submissionId}${reviewQueueQuery(filter)}`}
                      >
                        {actionable ? "评阅" : "查看"}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {workspace.release.executionVersion === 1 ||
          stage !== null ||
          workspace.progress.some((entry) => entry.group !== null) ? (
            <section className={styles.progressSection} id="progress">
              <header className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>
                    {workspace.release.executionVersion === 1
                      ? "顺序阶段"
                      : "共享提交"}
                  </p>
                  <h2>班级进度</h2>
                </div>
                <span>
                  {workspace.release.executionVersion === 1
                    ? `${workspace.release.phaseCount} 阶段`
                    : "整项提交"}
                </span>
              </header>
              {stage ? (
                <p className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  只看「{stageLabel(stage)}」的 {visibleProgress.length} 个学生或小组
                  <Link
                    className="font-medium underline-offset-4 hover:underline"
                    href={rosterHref(filter)}
                  >
                    显示全部
                  </Link>
                </p>
              ) : null}
              <div className={styles.reviewList}>
                {visibleProgress.map((progress) => {
                  const name =
                    progress.group?.name ?? progress.student.displayName;
                  const stageLabel = progress.complete
                    ? workspace.release.executionVersion === 1
                      ? "全部完成"
                      : "已提交"
                    : typeof progress.revisionPhaseIndex === "number"
                      ? progress.revisionPhaseIndex === 0
                        ? "待重交整项终稿"
                        : `待重交第 ${progress.revisionPhaseIndex} 阶段`
                    : progress.started
                      ? workspace.release.executionVersion === 0
                        ? "已开始"
                        : progress.currentPhaseIndex === 0
                          ? "在写整项终稿"
                          : `在做第 ${progress.currentPhaseIndex} 阶段`
                      : "尚未开始";
                  const percent =
                    progress.totalPhaseCount > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (progress.completedPhaseCount /
                              progress.totalPhaseCount) *
                              100,
                          ),
                        )
                      : progress.complete
                        ? 100
                        : 0;
                  return (
                    <article
                      className={styles.reviewRow}
                      key={progress.group?.id ?? progress.student.id}
                    >
                      <span aria-hidden="true" className={styles.avatar}>
                        {Array.from(name)[0]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className={styles.reviewName}>{name}</h3>
                        <p className={styles.reviewMeta}>
                          {progress.group
                            ? `小组 · ${progress.group.members
                                .map(
                                  (member) =>
                                    `${member.student.displayName}${
                                      member.roleLabel
                                        ? `（${member.roleLabel}）`
                                        : ""
                                    }`,
                                )
                                .join("、")}`
                            : `个人提交 · 学生编号 ${shortResourceId(progress.student.id)}`}
                        </p>
                      </div>
                      <div className="flex w-40 shrink-0 flex-col gap-1">
                        <div className={styles.progressBar} aria-hidden="true">
                          <span style={{ width: `${percent}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {workspace.release.executionVersion === 1
                            ? `已交 ${progress.completedPhaseCount}/${progress.totalPhaseCount} 阶段`
                            : progress.group
                              ? `${progress.group.members.length} 人共享一份提交`
                              : "个人提交"}
                        </span>
                      </div>
                      <div className={styles.reviewBadges}>
                        <StatusBadge
                          tone={
                            progress.complete
                              ? "done"
                              : typeof progress.revisionPhaseIndex === "number"
                                ? "pending"
                                : progress.started
                                  ? "neutral"
                                  : "closed"
                          }
                        >
                          {stageLabel}
                        </StatusBadge>
                        {progress.awaitingFormalRevision ? (
                          <StatusBadge tone="pending">还没提交</StatusBadge>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
          {workspace.release.status === "ACTIVE" ? (
            <details className={styles.settingsDisclosure}>
              <summary>活动设置 · 作业小组与关闭活动</summary>
              <div className="flex flex-col gap-4 pt-4">
                <ReleaseGroupManager
                  releaseId={workspace.release.id}
                  progress={workspace.progress}
                />
                <CloseActivityPanel
                  releaseId={workspace.release.id}
                  classroomName={workspace.release.classroomName}
                  prepareIdempotencySeed={`prepare_close_activity_${randomUUID()}`}
                />
              </div>
            </details>
          ) : null}
        </section>
      </div>
    </TeacherPage>
  );
}
