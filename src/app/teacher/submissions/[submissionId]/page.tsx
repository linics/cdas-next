import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
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

function SubmissionRevision({
  revision,
  current,
}: {
  revision: FormalRevision;
  current: boolean;
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
      <div className={styles.submissionBody}>{revision.textEvidence}</div>
      <FeedbackHistory revision={revision} />
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

  const { submission, student } = workspace;
  const currentRevision = submission.revisions.at(-1);
  if (!currentRevision) {
    notFound();
  }
  const latestFeedbackRevision = currentRevision.feedback?.revisions.at(-1);
  const content = submission.release.snapshot.content;
  const revisions = [...submission.revisions].reverse();

  return (
    <TeacherPage>
      <div>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>提交 / 教师反馈</p>
            <h1>{student.displayName}</h1>
            <p>
              {content.title} · {submission.release.classroom.name}
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

        <div className={styles.workspaceGrid}>
          <section
            className={styles.submissionHistory}
            aria-labelledby="submission-history-title"
          >
            <header className={styles.historyHeading}>
              <div>
                <p className={styles.eyebrow}>学生证据</p>
                <h2 id="submission-history-title">正式修订与反馈历史</h2>
              </div>
              <span>{revisions.length} 版 · 新版在前</span>
            </header>
            <div className={styles.revisionList}>
              {revisions.map((revision) => (
                <SubmissionRevision
                  key={revision.id}
                  revision={revision}
                  current={revision.id === currentRevision.id}
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
            <div className={styles.railNote} role="note">
              <p className={styles.eyebrow}>保存规则</p>
              <p>
                每次修改都新增不可变反馈版本。AI 服务停用时，这条手写与确认流程仍完整可用。
              </p>
            </div>
          </aside>
        </div>
      </div>
    </TeacherPage>
  );
}
