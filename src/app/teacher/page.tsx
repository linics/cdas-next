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
  type TeacherActivityDashboard,
} from "../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
} from "./_components/teacher-shell";
import styles from "./teacher-workspace.module.css";

const releaseStatus = {
  ACTIVE: { label: "开放中", tone: "active" },
  CLOSED: { label: "已关闭", tone: "closed" },
  ARCHIVED: { label: "已封存", tone: "sealed" },
} as const;

type DashboardRelease = TeacherActivityDashboard["releases"][number];

function attentionLine(attention: NonNullable<DashboardRelease["attention"]>) {
  return [
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
    .join(" · ");
}

function ReleaseCatalogRow({ release }: { release: DashboardRelease }) {
  const status = releaseStatus[release.status];
  const row = (
    <>
      <span className={styles.activityTitle}>{release.title}</span>
      <span className={styles.activityMeta}>
        {release.progress
          ? `${release.progress.submittedCount}/${release.progress.cohortSize} 已正式提交`
          : "无查看权限"}
        {release.dueAt ? " · " : ""}
        {release.dueAt ? (
          <>
            <LocalizedDateTime dateTime={release.dueAt} /> 截止
          </>
        ) : null}
      </span>
      <span className={styles.activityStatus}>
        <span className={styles.statusBadge} data-tone={status.tone}>
          {status.label}
        </span>
      </span>
    </>
  );
  if (!release.canViewSubmissions) {
    return (
      <div className={styles.nestedActivityRow} key={release.id}>
        {row}
      </div>
    );
  }
  return (
    <Link
      className={styles.nestedActivityRow}
      href={`/teacher/releases/${release.id}/submissions`}
    >
      {row}
    </Link>
  );
}

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
  const managedNames = new Set(
    dashboard.classrooms.map((classroom) => classroom.name),
  );
  const orphanReleases = dashboard.releases.filter(
    (release) => !managedNames.has(release.classroomName),
  );

  return (
    <TeacherPage
      actorName={dashboard.actor.displayName}
      breadcrumb={[{ label: "教师工作台" }]}
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>教师工作台 / 概览</p>
            <h1>待处理的提交与班级</h1>
            <p>
              集中处理待评阅的学生提交；已发布活动按班级归类，未发布的草稿在「活动设计」中。
            </p>
          </div>
        </header>

        <div className={styles.dashboardBody}>
          <div className={styles.dashboardMain}>
            <section className={styles.dashboardSection}>
              <header className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>待处理</p>
                  <h2>待办</h2>
                </div>
                <span>{actionable.length} 项</span>
              </header>
              {actionable.length === 0 ? (
                <p className={styles.emptyState}>
                  当前没有待反馈、待评价或待重交的提交。
                </p>
              ) : (
                <>
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
                  <div className={styles.activityList}>
                    {actionable.map(({ release, attention }) => (
                      <Link
                        className={styles.activityRow}
                        href={`/teacher/releases/${release.id}/submissions`}
                        key={release.id}
                      >
                        <span className={styles.activityWho}>
                          {release.classroomName}
                        </span>
                        <span className={styles.activityTitle}>
                          {release.title}
                        </span>
                        <span className={styles.activityMeta}>
                          {attentionLine(attention)}
                        </span>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className={styles.dashboardSection}>
              <header className={styles.sectionHeader}>
                <div>
                  <p className={styles.eyebrow}>任教班级</p>
                  <h2>班级</h2>
                </div>
                <span>{dashboard.classrooms.length} 个</span>
              </header>
              {dashboard.classrooms.length === 0 ? (
                <p className={styles.emptyState}>
                  暂无分配给你的班级。你仍可保存活动草稿，待管理员完成班级配置后即可发布。
                </p>
              ) : (
                <div className={styles.classroomCardList}>
                  {dashboard.classrooms.map((classroom) => {
                    const releases = dashboard.releases.filter(
                      (release) => release.classroomName === classroom.name,
                    );
                    return (
                      <article
                        className={styles.classroomCard}
                        key={classroom.id}
                      >
                        <header className={styles.classroomCardHead}>
                          <div>
                            <p className={styles.eyebrow}>班级</p>
                            <h3>{classroom.name}</h3>
                          </div>
                          <Link
                            className={styles.rowLink}
                            href={`/teacher/classrooms/${classroom.id}/members`}
                          >
                            {classroom.currentMemberCount} 名成员
                          </Link>
                        </header>
                        {releases.length === 0 ? (
                          <p className={styles.asideNote}>
                            尚未向该班级发布活动。
                          </p>
                        ) : (
                          <div className={styles.activityList}>
                            {releases.map((release) => (
                              <ReleaseCatalogRow
                                key={release.id}
                                release={release}
                              />
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
              {orphanReleases.length > 0 ? (
                <div className={styles.classroomCardList}>
                  <article className={styles.classroomCard}>
                    <header className={styles.classroomCardHead}>
                      <div>
                        <p className={styles.eyebrow}>历史发布</p>
                        <h3>已不在管理范围的班级</h3>
                      </div>
                    </header>
                    <div className={styles.activityList}>
                      {orphanReleases.map((release) => (
                        <ReleaseCatalogRow
                          key={release.id}
                          release={release}
                        />
                      ))}
                    </div>
                  </article>
                </div>
              ) : null}
              <p className={styles.asideNote}>
                仅班级管理教师可以发布活动和查看提交；管理权变更后，历史发布记录仍会保留，但不能查看其提交内容。
              </p>
            </section>
          </div>
        </div>
      </div>
    </TeacherPage>
  );
}
