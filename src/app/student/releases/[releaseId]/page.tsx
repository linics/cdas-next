import { randomUUID } from "node:crypto";
import { SignInButton, SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
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
import { SubmissionEditor } from "./submission-editor";
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
    <aside className={styles.releaseBrief} aria-labelledby="release-brief-title">
      <div className={styles.briefHeading}>
        <p className={styles.eyebrow}>活动要求</p>
        <h2 id="release-brief-title">发布快照</h2>
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
    </aside>
  );
}

function RevisionHistory({
  submission,
  feedbackWorkspace,
}: {
  submission: StudentReleaseWorkspace["submission"];
  feedbackWorkspace: StudentFeedbackWorkspace | null;
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
          <p className={styles.eyebrow}>不可变历史</p>
          <h2 id="history-title">正式修订</h2>
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
            const feedbackHeadingId = `feedback-${revision.id}`;

            return (
              <article className={styles.revision} key={revision.id}>
                <header>
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
                </header>
                <p className={styles.formalNote}>正式修订 · 内容不可覆盖</p>
                <div className={styles.revisionText}>
                  {revision.textEvidence}
                </div>
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
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={styles.emptyFeedback}>
                      此正式修订尚无教师已确认的反馈。
                    </p>
                  )}
                </section>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default async function StudentReleasePage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  let context;
  let workspace: StudentReleaseWorkspace;
  let feedbackWorkspace: StudentFeedbackWorkspace | null = null;

  try {
    context = await createUiCommandContext();
    const database = getDatabaseClient();
    workspace = await getStudentReleaseWorkspace(database, context, {
      releaseId,
    });
    if (workspace.submission) {
      feedbackWorkspace = await getStudentFeedbackWorkspace(
        database,
        context,
        { submissionId: workspace.submission.id },
      );
      if (
        feedbackWorkspace.submission.id !== workspace.submission.id ||
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
  const currentSubmissionLabel = workspace.submission?.workingCopy
    ? workspace.submission.workingCopy.baseRevisionNumber > 0
      ? `第 ${workspace.submission.workingCopy.baseRevisionNumber + 1} 版重交草稿`
      : "未提交草稿"
    : workspace.submission && workspace.submission.latestRevisionNumber > 0
      ? `第 ${workspace.submission.latestRevisionNumber} 版已正式提交`
      : "尚未创建草稿";
  const attachmentStorageEnabled =
    createAttachmentStorageFromEnvironment() !== null;

  return (
    <WorkspaceShell
      audience="学生"
      actorName={workspace.actor.displayName}
    >
      <div className={styles.releasePage}>
        <Link className={styles.backLink} href="/student">← 返回我的活动</Link>
        <header className={styles.releaseHeader}>
          <div>
            <p className={styles.eyebrow}>学习活动 / 文字提交</p>
            <h1>{content.title}</h1>
            <p>{content.summary}</p>
          </div>
          <StatusBadge tone={!isActive || !canWrite ? "neutral" : isPastDue ? "warning" : "success"}>
            {statusLabel}
          </StatusBadge>
        </header>

        <dl className={styles.releaseFacts}>
          <div>
            <dt>发布时间</dt>
            <dd>
              <LocalizedDateTime dateTime={workspace.release.publishedAt} />
            </dd>
          </div>
          <div>
            <dt>截止时间</dt>
            <dd>
              {dueAt ? <LocalizedDateTime dateTime={dueAt} /> : "未设置"}
            </dd>
          </div>
          <div>
            <dt>当前进度</dt>
            <dd>{currentSubmissionLabel}</dd>
          </div>
        </dl>

        {isPastDue && isActive && canWrite ? (
          <div className={styles.lateNotice}>
            <InlineAlert tone="warning">
              <strong>截止时间已过，但活动仍开放。</strong> 你仍可保存并正式提交；新创建的正式修订会永久标记为迟交。
            </InlineAlert>
          </div>
        ) : null}

        <div className={styles.workspaceGrid}>
          <div className={styles.submissionColumn}>
            <SubmissionEditor
              releaseId={releaseId}
              submission={workspace.submission}
              canWrite={canWrite}
              isPastDue={isPastDue}
              attachmentStorageEnabled={attachmentStorageEnabled}
              readOnlyMessage={readOnlyMessage}
              workingCopyUpdatedLabel={
                workspace.submission?.workingCopy
                  ? <LocalizedDateTime
                      dateTime={workspace.submission.workingCopy.updatedAt}
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
              submission={workspace.submission}
              feedbackWorkspace={feedbackWorkspace}
            />
          </div>
          <ReleaseBrief snapshot={workspace.release.snapshot} />
        </div>
      </div>
    </WorkspaceShell>
  );
}
