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

  const readyCount = dashboard.drafts.filter(
    (draft) => draft.status === "READY_FOR_PREVIEW",
  ).length;

  return (
    <TeacherPage actorName={dashboard.actor.displayName}>
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>教师工作台 / 活动闭环</p>
            <h1>你的活动、班级与发布</h1>
            <p>
              从草稿版本走到不可变发布，再进入学生正式提交；这里只列出当前教师身份有权操作的资源。
            </p>
          </div>
          <Link className={styles.primaryLink} href="/teacher/activities/new">
            新建学习活动 <span aria-hidden="true">＋</span>
          </Link>
        </header>

        <dl className={styles.overviewStrip} aria-label="工作台摘要">
          <div>
            <dt>我的草稿</dt>
            <dd>{dashboard.drafts.length}</dd>
          </div>
          <div>
            <dt>可进入发布预览</dt>
            <dd>{readyCount}</dd>
          </div>
          <div>
            <dt>我管理的班级</dt>
            <dd>{dashboard.classrooms.length}</dd>
          </div>
        </dl>

        <div className={styles.dashboardBody}>
          <div className={styles.dashboardMain}>
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
                      <article className={styles.activityRow} key={draft.id}>
                        <div>
                          <h3>{draft.title}</h3>
                          <p>
                            版本 {draft.version} ·{" "}
                            <LocalizedDateTime dateTime={draft.updatedAt} /> 更新
                          </p>
                        </div>
                        <span
                          className={styles.statusBadge}
                          data-tone={status.tone}
                        >
                          {status.label}
                        </span>
                        <Link
                          className={styles.rowLink}
                          href={`/teacher/activities/${draft.id}`}
                        >
                          {draft.status === "SEALED" ? "查看" : "编辑"} →
                        </Link>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

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
                <div className={styles.releaseList}>
                  {dashboard.releases.map((release) => {
                    const status = releaseStatus[release.status];
                    return (
                      <article className={styles.releaseRow} key={release.id}>
                        <div>
                          <h3>{release.title}</h3>
                          <p>
                            <LocalizedDateTime dateTime={release.publishedAt} />{" "}
                            发布
                            {release.dueAt ? (
                              <>
                                {" · "}
                                <LocalizedDateTime dateTime={release.dueAt} />{" "}
                                截止
                              </>
                            ) : (
                              " · 未设置截止"
                            )}
                          </p>
                        </div>
                        <div>
                          <h3>{release.classroomName}</h3>
                          <p>目标班级</p>
                          {release.attention &&
                          (release.attention.pendingFeedbackCount > 0 ||
                            release.attention.pendingEvaluationCount > 0 ||
                            release.attention.awaitingResubmissionCount > 0) ? (
                            <p>
                              {[
                                release.attention.pendingFeedbackCount > 0
                                  ? `待反馈 ${release.attention.pendingFeedbackCount}`
                                  : null,
                                release.attention.pendingEvaluationCount > 0
                                  ? `待评价 ${release.attention.pendingEvaluationCount}`
                                  : null,
                                release.attention.awaitingResubmissionCount > 0
                                  ? `待重交 ${release.attention.awaitingResubmissionCount}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        {release.canViewSubmissions ? (
                          <Link
                            className={styles.rowLink}
                            href={`/teacher/releases/${release.id}/submissions`}
                          >
                            查看提交 →
                          </Link>
                        ) : (
                          <span
                            className={styles.statusBadge}
                            data-tone={status.tone}
                          >
                            {status.label} · 班级管理权已变更
                          </span>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <aside className={styles.dashboardAside}>
            <header className={styles.sectionHeader}>
              <div>
                <p className={styles.eyebrow}>发布边界</p>
                <h2>我管理的班级</h2>
              </div>
              <span>{dashboard.classrooms.length} 个</span>
            </header>
            {dashboard.classrooms.length === 0 ? (
              <p className={styles.configurationNote} role="note">
                当前没有预先配置给你的班级，因此可保存草稿，但不能准备发布。请由系统管理流程先创建班级归属。
              </p>
            ) : (
              <div className={styles.classroomList}>
                {dashboard.classrooms.map((classroom) => (
                  <article className={styles.classroomRow} key={classroom.id}>
                    <div>
                      <h3>{classroom.name}</h3>
                      <p>当前有效成员</p>
                    </div>
                    <strong>{classroom.currentMemberCount} 名</strong>
                    <Link href={`/teacher/classrooms/${classroom.id}/members`}>
                      管理成员 →
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </TeacherPage>
  );
}
