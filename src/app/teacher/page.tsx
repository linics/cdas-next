import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { LocalizedDateTime } from "../_components/localized-date-time";
import { WorkspaceRoleGate } from "../_components/workspace-shell";
import { AuthenticationError } from "../../server/auth/current-actor";
import { createUiCommandContext } from "../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../server/db/client";
import {
  getTeacherActivityDashboard,
  TeacherActivityQueryError,
} from "../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
} from "./_components/teacher-shell";
import styles from "./teacher-workspace.module.css";

const draftStatus = {
  EDITING: { label: "编辑中", tone: "editing" },
  READY_FOR_PREVIEW: { label: "可预览", tone: "ready" },
  SEALED: { label: "已封存", tone: "sealed" },
} as const;

const releaseStatus = {
  ACTIVE: { label: "开放中", tone: "active" },
  CLOSED: { label: "已关闭", tone: "closed" },
  ARCHIVED: { label: "已封存", tone: "sealed" },
} as const;

export default async function TeacherDashboardPage() {
  let dashboard;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    dashboard = await getTeacherActivityDashboard(database, context, {});
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <TeacherAccessGate code={error.code} returnPath="/teacher" />;
    }
    if (
      error instanceof TeacherActivityQueryError &&
      error.code === "WRONG_ROLE" &&
      error.actorName
    ) {
      return (
        <WorkspaceRoleGate
          actorName={error.actorName}
          currentAudience="学生"
          requestedAudience="教师"
        />
      );
    }
    if (error instanceof TeacherActivityQueryError || error instanceof ZodError) {
      notFound();
    }
    throw error;
  }

  const actionable = dashboard.releases
    .filter(
      (release) =>
        release.attention !== null &&
        (release.attention.pendingFeedbackCount > 0 ||
          release.attention.pendingEvaluationCount > 0 ||
          release.attention.awaitingResubmissionCount > 0),
    )
    .map((release) => ({ release, attention: release.attention! }));
  const totals = actionable.reduce(
    (sum, { attention }) => ({
      feedback: sum.feedback + attention.pendingFeedbackCount,
      evaluation: sum.evaluation + attention.pendingEvaluationCount,
      resubmission: sum.resubmission + attention.awaitingResubmissionCount,
    }),
    { feedback: 0, evaluation: 0, resubmission: 0 },
  );

  return (
    <TeacherPage
      actorName={dashboard.actor.displayName}
      breadcrumb="教师工作台"
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>教师工作台 / 活动闭环</p>
            <h1>你的活动、班级与发布</h1>
            <p>
              从草稿版本走到不可变发布，再进入学生正式提交；这里只列出当前教师身份有权操作的资源。
            </p>
          </div>
          <div className={styles.pageHeaderActions}>
            <Link className={styles.secondaryButton} href="/teacher/insights">
              过程诊断
            </Link>
            <Link className={styles.primaryLink} href="/teacher/activities/new">
              新建学习活动 <span aria-hidden="true">＋</span>
            </Link>
          </div>
        </header>

        <div className={styles.dashboardBody}>
          <div className={styles.dashboardMain}>
            {/* 待办从各张发布卡片里抽出来，聚成一个置顶区块：教师进来先看到
                今天要处理什么，而不是挨张卡片自己数。 */}
            <section className={styles.dashboardSection}>
              <header className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>需要我处理</p>
                  <h2>待办</h2>
                </div>
                <span>{actionable.length} 个发布</span>
              </header>
              {actionable.length === 0 ? (
                <p className={styles.emptyState}>
                  当前没有待反馈、待评价或待重交的提交。
                </p>
              ) : (
                <>
                  {/* 只列真有的那几档：0 不是待办，写成「待评价 0」会让人以为有事要做。 */}
                  <dl className={styles.attentionTotals}>
                    {(
                      [
                        ["待反馈", totals.feedback],
                        ["待评价", totals.evaluation],
                        ["待重交", totals.resubmission],
                      ] as const
                    )
                      .filter(([, count]) => count > 0)
                      .map(([label, count]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{count}</dd>
                        </div>
                      ))}
                  </dl>
                  <div className={styles.attentionList}>
                    {actionable.map(({ release, attention }) => (
                      <Link
                        className={styles.attentionRow}
                        href={`/teacher/releases/${release.id}/submissions`}
                        key={release.id}
                      >
                        <span className={styles.attentionWho}>
                          {release.classroomName}
                        </span>
                        <span className={styles.attentionWhat}>
                          {release.title}
                        </span>
                        <span className={styles.attentionNeeds}>
                          {[
                            attention.pendingFeedbackCount > 0
                              ? `待反馈 ${attention.pendingFeedbackCount}`
                              : null,
                            attention.pendingEvaluationCount > 0
                              ? `待评价 ${attention.pendingEvaluationCount}`
                              : null,
                            attention.awaitingResubmissionCount > 0
                              ? `待重交 ${attention.awaitingResubmissionCount}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </section>

            {/* 发布压成单行摘要：班级、标题、提交进度、状态。细节进评阅名册。 */}
            <section className={styles.dashboardSection}>
              <header className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>不可变快照</p>
                  <h2>我的发布</h2>
                </div>
                <span>{dashboard.releases.length} 次</span>
              </header>
              {dashboard.releases.length === 0 ? (
                <p className={styles.emptyState}>
                  尚未发布活动。草稿标记为可预览后，仍需完成独立教师确认才会产生发布。
                </p>
              ) : (
                <div className={styles.activityList}>
                  {dashboard.releases.map((release) => {
                    const status = releaseStatus[release.status];
                    const row = (
                      <>
                        <span className={styles.activityTitle}>
                          {release.classroomName} · {release.title}
                        </span>
                        <span className={styles.activityMeta}>
                          {release.progress
                            ? `${release.progress.submittedCount}/${release.progress.cohortSize} 已正式提交`
                            : "无读取权限"}
                          {release.dueAt ? " · " : ""}
                          {release.dueAt ? (
                            <>
                              <LocalizedDateTime dateTime={release.dueAt} /> 截止
                            </>
                          ) : null}
                        </span>
                        <span
                          className={styles.statusBadge}
                          data-tone={status.tone}
                        >
                          {status.label}
                        </span>
                      </>
                    );
                    return release.canViewSubmissions ? (
                      <Link
                        className={styles.activityRow}
                        href={`/teacher/releases/${release.id}/submissions`}
                        key={release.id}
                      >
                        {row}
                      </Link>
                    ) : (
                      <div className={styles.activityRow} key={release.id}>
                        {row}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={styles.dashboardSection}>
              <header className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>活动设计</p>
                  <h2>我的草稿</h2>
                </div>
                <span>{dashboard.drafts.length} 份</span>
              </header>
              {dashboard.drafts.length === 0 ? (
                <p className={styles.emptyState}>
                  尚未创建活动草稿。使用「新建学习活动」即可开始第一个可追溯版本。
                </p>
              ) : (
                <div className={styles.activityList}>
                  {dashboard.drafts.map((draft) => {
                    const status = draftStatus[draft.status];
                    return (
                      <Link
                        className={styles.activityRow}
                        href={`/teacher/activities/${draft.id}`}
                        key={draft.id}
                      >
                        <span className={styles.activityTitle}>
                          {draft.title}
                        </span>
                        <span className={styles.activityMeta}>
                          版本 {draft.version} ·{" "}
                          <LocalizedDateTime dateTime={draft.updatedAt} /> 更新
                        </span>
                        <span
                          className={styles.statusBadge}
                          data-tone={status.tone}
                        >
                          {status.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <aside className={styles.dashboardAside}>
            <div>
              <p className={styles.eyebrow}>我管理的班级</p>
              {dashboard.classrooms.length === 0 ? (
                <p className={styles.asideNote} role="note">
                  当前没有预先配置给你的班级，因此可保存草稿，但不能准备发布。请由系统管理流程先创建班级归属。
                </p>
              ) : (
                <div className={styles.classroomList}>
                  {dashboard.classrooms.map((classroom) => (
                    <Link
                      className={styles.classroomRow}
                      href={`/teacher/classrooms/${classroom.id}/members`}
                      key={classroom.id}
                    >
                      <span>{classroom.name}</span>
                      <span>{classroom.currentMemberCount} 名</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className={styles.eyebrow}>发布边界</p>
              <p className={styles.asideNote}>
                只有班级管理者可以发布活动与阅读提交；班级管理权变更后，历史发布仍保留，但不再可读。
              </p>
            </div>
          </aside>
        </div>
      </div>
    </TeacherPage>
  );
}
