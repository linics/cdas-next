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
} from "../../../_components/teacher-shell";
import styles from "../../../teacher-workspace.module.css";
import { CloseActivityPanel } from "./close-activity-panel";
import { ReleaseGroupManager } from "./release-group-manager";

export default async function TeacherReleaseSubmissionsPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
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

  return (
    <TeacherPage actorName={workspace.actor.displayName}>
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>发布 / 正式提交</p>
            <h1>{workspace.release.title}</h1>
            <p>
              {workspace.release.classroomName} · 发布{" "}
              {shortResourceId(workspace.release.id)} ·{" "}
              <LocalizedDateTime dateTime={workspace.release.publishedAt} />{" "}
              发布。阶段进度只读取容器与正式修订状态，不读取学生工作草稿正文或附件元数据。
            </p>
          </div>
          <Link className={styles.secondaryButton} href="/teacher">
            ← 返回工作台
          </Link>
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
          workspace.progress.some((entry) => entry.group !== null) ? (
            <section className={styles.progressSection}>
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
              <div className={styles.submissionList}>
                {workspace.progress.map((progress) => (
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
                          : `个人提交 · 学生识别 ${shortResourceId(progress.student.id)}`}
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
                      </strong>
                      <small>
                        {workspace.release.executionVersion === 1
                          ? `已完成 ${progress.completedPhaseCount}/${progress.totalPhaseCount} 阶段`
                          : progress.group
                            ? `${progress.group.members.length} 名成员共享一份提交`
                            : "个人提交"}
                      </small>
                    </div>
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
            <span>{workspace.submissions.length} 份</span>
          </header>

          {workspace.submissions.length === 0 ? (
            <p className={styles.emptyState}>
              尚无正式提交。未正式提交的学生工作草稿不会出现在教师列表中。
            </p>
          ) : (
            <div className={styles.submissionList}>
              {workspace.submissions.map((submission) => (
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
                        : ` · 学生识别 ${shortResourceId(submission.student.id)}`}
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
                    </small>
                  </div>
                  <Link
                    className={styles.rowLink}
                    href={`/teacher/submissions/${submission.submissionId}`}
                  >
                    查看与反馈 →
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
