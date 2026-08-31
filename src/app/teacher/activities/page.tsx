import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { LocalizedDateTime } from "../../_components/localized-date-time";
import { WorkspaceRoleGate } from "../../_components/workspace-shell";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import {
  getTeacherActivityDashboard,
  TeacherActivityQueryError,
} from "../../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
  teacherHomeCrumb,
} from "../_components/teacher-shell";
import styles from "../teacher-workspace.module.css";

const draftStatus = {
  EDITING: { label: "编辑中", tone: "editing" },
  READY_FOR_PREVIEW: { label: "可预览", tone: "ready" },
} as const;

function isOpenDraft(status: string): status is keyof typeof draftStatus {
  return status === "EDITING" || status === "READY_FOR_PREVIEW";
}

export default async function TeacherActivityStudioPage() {
  let dashboard;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    dashboard = await getTeacherActivityDashboard(database, context, {});
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <TeacherAccessGate code={error.code} returnPath="/teacher/activities" />
      );
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

  const openDrafts = dashboard.drafts.filter((draft) =>
    isOpenDraft(draft.status),
  );

  return (
    <TeacherPage
      actorName={dashboard.actor.displayName}
      breadcrumb={[teacherHomeCrumb, { label: "跨学科任务" }]}
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <h1>跨学科任务</h1>
          </div>
          <div className={styles.pageHeaderActions}>
            <Link className={styles.secondaryButton} href="/teacher/knowledge">
              检索课程标准
            </Link>
            <Link className={styles.primaryLink} href="/teacher/activities/new">
              新建跨学科任务 <span aria-hidden="true">＋</span>
            </Link>
          </div>
        </header>

        <div className={styles.dashboardBody}>
          <section className={styles.dashboardSection}>
            <header className={styles.sectionHeader}>
              <div>
                <h2>我的草稿</h2>
              </div>
              <span>{openDrafts.length} 份</span>
            </header>
            {openDrafts.length === 0 ? (
              <p className={styles.emptyState}>
                暂无进行中的草稿。点击「新建跨学科任务」开始设计。
              </p>
            ) : (
              <div className={styles.activityList}>
                {openDrafts.map((draft) => {
                  if (!isOpenDraft(draft.status)) {
                    return null;
                  }
                  const status = draftStatus[draft.status];
                  return (
                    <Link
                      className={styles.nestedActivityRow}
                      href={`/teacher/activities/${draft.id}`}
                      key={draft.id}
                    >
                      <span className={styles.activityTitle}>{draft.title}</span>
                      <span className={styles.activityMeta}>
                        版本 {draft.version} ·{" "}
                        <LocalizedDateTime dateTime={draft.updatedAt} /> 更新
                      </span>
                      <span className={styles.activityStatus}>
                        <span
                          className={styles.statusBadge}
                          data-tone={status.tone}
                        >
                          {status.label}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </TeacherPage>
  );
}
