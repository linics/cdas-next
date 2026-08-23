import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { ArrowLeftIcon, ArrowRightIcon } from "../../../../_components/flat-icons";
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
              发布。列表只包含当前正式修订的中继数据，不读取学生工作草稿或正文。
            </p>
          </div>
          <Link className={styles.secondaryButton} href="/teacher">
            <ArrowLeftIcon /> 返回工作台
          </Link>
        </header>

        <section className={styles.submissionPage}>
          {workspace.release.status === "ACTIVE" ? (
            <CloseActivityPanel
              releaseId={workspace.release.id}
              classroomName={workspace.release.classroomName}
              prepareIdempotencySeed={`prepare_close_activity_${randomUUID()}`}
            />
          ) : null}
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>当前正式版本</p>
              <h2>已提交学生</h2>
            </div>
            <span>{workspace.submissions.length} 人</span>
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
                    <h2>{submission.student.displayName}</h2>
                    <p>学生识别 {shortResourceId(submission.student.id)}</p>
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
                    查看与反馈 <ArrowRightIcon />
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
