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
  const rubricAvailable = workspace.release.rubricAvailable;
  const countFor = (candidate: ReviewQueueFilter) =>
    queueItems.filter((item) =>
      matchesReviewQueue(item, candidate, rubricAvailable),
    ).length;
  const visibleIds = new Set(
    queueItems
      .filter((item) => matchesReviewQueue(item, filter, rubricAvailable))
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
          {workspace.release.status === "ACTIVE" ? (
            <>
              <CloseActivityPanel
                releaseId={workspace.release.id}
                classroomName={workspace.release.classroomName}
                prepareIdempotencySeed={`prepare_close_activity_${randomUUID()}`}
              />
              <ReleaseGroupManager
                releaseId={workspace.release.id}
                progress={workspace.progress}
              />
            </>
          ) : null}
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
              <div className={styles.submissionList}>
                {visibleProgress.map((progress) => (
                  <article
                    className={styles.submissionRow}
                    key={progress.group?.id ?? progress.student.id}
                  >
                    <div>
                      <h2>
                        {progress.group?.name ?? progress.student.displayName}
                      </h2>
                      <p>
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
                    <div className={styles.submissionMeta}>
                      <strong>
                        {progress.complete
                          ? workspace.release.executionVersion === 1
                            ? "全部完成"
                            : "已正式提交"
                          : progress.started
                            ? workspace.release.executionVersion === 0
                              ? "已开始"
                              : progress.currentPhaseIndex === 0
                              ? "正在整理整项终稿"
                              : `当前第 ${progress.currentPhaseIndex} 阶段`
                            : "尚未开始"}
                        {progress.awaitingFormalRevision
                          ? " · 尚未正式提交"
                          : ""}
                      </strong>
                      <small>
                        {workspace.release.executionVersion === 1
                          ? `已完成 ${progress.completedPhaseCount}/${progress.totalPhaseCount} 阶段`
                          : progress.group
                            ? `${progress.group.members.length} 名成员共享一份提交`
                            : "个人提交"}
                      </small>
                    </div>
                    {workspace.release.executionVersion === 1 &&
                    progress.totalPhaseCount > 0 ? (
                      <div aria-hidden="true" className={styles.rowProgress}>
                        <span
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round(
                                (progress.completedPhaseCount /
                                  progress.totalPhaseCount) *
                                  100,
                              ),
                            )}%`,
                          }}
                        />
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>当前正式版本</p>
              <h2>正式提交记录</h2>
            </div>
            <span>
              {workspace.submissions.length} 份
              {workspace.reviewCoverage.currentRevisionCount > 0
                ? ` · 已反馈 ${workspace.reviewCoverage.feedbackCount}/${workspace.reviewCoverage.currentRevisionCount}`
                : ""}
              {workspace.release.rubricAvailable &&
              workspace.reviewCoverage.currentRevisionCount > 0
                ? ` · 已评价 ${workspace.reviewCoverage.evaluationCount}/${workspace.reviewCoverage.currentRevisionCount}`
                : ""}
              {awaitingResubmissionCount > 0
                ? ` · 待重交 ${awaitingResubmissionCount}`
                : ""}
            </span>
          </header>

          {workspace.submissions.length > 0 ? (
            <nav aria-label="评阅筛选" className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {reviewQueueStatuses
                  // An empty status is noise; keep "全部" and whatever is selected.
                  .filter(
                    (status) =>
                      (status.code !== "evaluation" || rubricAvailable) &&
                      (status.code === "all" ||
                        status.code === filter.status ||
                        countFor({ ...filter, status: status.code }) > 0),
                  )
                  .map((status) => {
                    const next = { ...filter, status: status.code };
                    return (
                      <Link
                        aria-current={filter.status === status.code ? "true" : undefined}
                        className={chip(filter.status === status.code)}
                        href={rosterHref(next)}
                        key={status.code}
                      >
                        {status.label}
                        <span className="tabular-nums">{countFor(next)}</span>
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
              尚无正式提交。学生未提交的草稿不会显示在这里。
            </p>
          ) : visibleSubmissions.length === 0 ? (
            <p className={styles.emptyState}>
              当前筛选下没有提交。
            </p>
          ) : (
            <div className={styles.submissionList}>
              {visibleSubmissions.map((submission) => (
                <article
                  className={styles.submissionRow}
                  key={submission.submissionId}
                >
                  <div>
                    <h2>
                      {submission.group?.name ?? submission.student.displayName}
                    </h2>
                    <p>
                      {submission.phaseName
                        ? `第 ${submission.phaseIndex} 阶段 · ${submission.phaseName}`
                        : "整项提交"}
                      {submission.group
                        ? ` · 小组共享 · ${submission.group.members
                            .map((member) => member.student.displayName)
                            .join("、")}`
                        : ` · 学生编号 ${shortResourceId(submission.student.id)}`}
                    </p>
                  </div>
                  <div className={styles.submissionMeta}>
                    <strong>正式修订 {submission.currentRevision.revisionNumber}</strong>
                    <small>
                      <LocalizedDateTime
                        dateTime={submission.currentRevision.submittedAt}
                      />
                      {submission.currentRevision.isLate ? " · 迟交" : ""}
                      {submission.currentRevision.feedback
                        ? ` · 已反馈 v${submission.currentRevision.feedback.currentVersion}`
                        : " · 待反馈"}
                      {workspace.release.rubricAvailable
                        ? submission.currentRevision.evaluation
                          ? ` · 已评价 v${submission.currentRevision.evaluation.currentVersion}`
                          : " · 待评价"
                        : " · 无量规"}
                      {submission.currentRevision.followUp ===
                      "AWAITING_RESUBMISSION"
                        ? " · 待重交"
                        : submission.currentRevision.followUp ===
                            "RESUBMISSION_IN_PROGRESS"
                          ? " · 重交中"
                          : ""}
                    </small>
                  </div>
                  <Link
                    className={styles.rowLink}
                    href={`/teacher/submissions/${submission.submissionId}${reviewQueueQuery(filter)}`}
                  >
                    查看反馈与评价 →
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </TeacherPage>
  );
}
