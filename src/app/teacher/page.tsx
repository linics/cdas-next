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
                <div className={styles.releaseCardList}>
                  {dashboard.releases.map((release) => {
                    const status = releaseStatus[release.status];
                    const attention = release.attention;
                    return (
                      <article className={styles.releaseCard} key={release.id}>
                        <div className={styles.releaseCardHead}>
                          <div>
                            <h3>{release.classroomName}</h3>
                            <p>{release.title}</p>
                          </div>
                          {release.dueAt ? (
                            <span className={styles.dueTag}>
                              <LocalizedDateTime dateTime={release.dueAt} /> 截止
                            </span>
                          ) : (
                            <span className={styles.metaTag}>未设置截止</span>
                          )}
                        </div>

                        {release.progress ? (
                          <>
                            <p className={styles.releaseProgress}>
                              <span>{release.progress.submittedCount}</span>
                              <span>
                                / {release.progress.cohortSize} 人已正式提交
                              </span>
                            </p>
                            <div
                              aria-hidden="true"
                              className={styles.progressTrack}
                            >
                              <span
                                style={{
                                  width:
                                    release.progress.cohortSize > 0
                                      ? `${Math.min(
                                          100,
                                          Math.round(
                                            (release.progress.submittedCount /
                                              release.progress.cohortSize) *
                                              100,
                                          ),
                                        )}%`
                                      : "0%",
                                }}
                              />
                            </div>
                          </>
                        ) : null}

                        <div className={styles.releaseCardFoot}>
                          {attention && attention.pendingFeedbackCount > 0 ? (
                            <span
                              className={styles.statusBadge}
                              data-tone="attention"
                            >
                              待反馈 {attention.pendingFeedbackCount}
                            </span>
                          ) : null}
                          {attention && attention.pendingEvaluationCount > 0 ? (
                            <span
                              className={styles.statusBadge}
                              data-tone="next"
                            >
                              待评价 {attention.pendingEvaluationCount}
                            </span>
                          ) : null}
                          {attention &&
                          attention.awaitingResubmissionCount > 0 ? (
                            <span
                              className={styles.statusBadge}
                              data-tone="waiting"
                            >
                              待重交 {attention.awaitingResubmissionCount}
                            </span>
                          ) : null}
                          {release.canViewSubmissions ? (
                            <Link
                              className={styles.cardAction}
                              href={`/teacher/releases/${release.id}/submissions`}
                            >
                              查看提交
                            </Link>
                          ) : (
                            <span
                              className={styles.statusBadge}
                              data-tone={status.tone}
                            >
                              {status.label} · 班级管理权已变更
                            </span>
                          )}
                        </div>

                        <p className={styles.releaseAudit}>
                          <LocalizedDateTime dateTime={release.publishedAt} />{" "}
                          发布 · {status.label}
                        </p>
                      </article>
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
