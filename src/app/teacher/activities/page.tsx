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
import { styles } from "../teacher-ui";
import { listOwnTaskBookWorkingCopies } from "../../../server/queries/activity-draft-working-copy";

const draftStatus = {
  EDITING: { label: "编辑中", tone: "editing" },
  READY_FOR_PREVIEW: { label: "可预览", tone: "ready" },
} as const;

function isOpenDraft(status: string): status is keyof typeof draftStatus {
  return status === "EDITING" || status === "READY_FOR_PREVIEW";
}

export default async function TeacherActivityStudioPage() {
  let dashboard;
  let unsaved: Awaited<ReturnType<typeof listOwnTaskBookWorkingCopies>> = [];
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    dashboard = await getTeacherActivityDashboard(database, context, {});
    unsaved = await listOwnTaskBookWorkingCopies(database, context);
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
  // D-093: task books started but never saved as a version, and drafts with
  // unsaved edits, so nothing a teacher typed is only findable by its URL.
  const unsavedNew = unsaved.filter((copy) => copy.draftId === null);
  const unsavedByDraft = new Map(
    unsaved.flatMap((copy) => (copy.draftId ? [[copy.draftId, copy] as const] : [])),
  );

  return (
    <TeacherPage
      actorName={dashboard.actor.displayName}
      breadcrumb={[teacherHomeCrumb, { label: "活动设计" }]}
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <h1>未发布的活动草稿</h1>

          </div>
          <div className={styles.pageHeaderActions}>
            <Link className={styles.secondaryButton} href="/teacher/knowledge">
              检索课程标准
            </Link>
            <Link className={styles.secondaryButton} href="/teacher/activities/copy">
              复用已有活动
            </Link>
            <Link className={styles.primaryLink} href="/teacher/activities/new">
              新建学习活动 <span aria-hidden="true">＋</span>
            </Link>
          </div>
        </header>

        <div className={styles.dashboardBody}>
          <section className={styles.dashboardSection}>
            <header className={styles.sectionHeader}>
              <div>
                <p className={styles.eyebrow}>继续编辑</p>
                <h2>我的草稿</h2>
              </div>
              <span>{openDrafts.length + unsavedNew.length} 份</span>
            </header>
            {openDrafts.length === 0 && unsavedNew.length === 0 ? (
              <p className={styles.emptyState}>
                暂无进行中的草稿。点击「新建学习活动」开始设计。
              </p>
            ) : (
              <div className={styles.activityList}>
                {unsavedNew.map((copy) => (
                  <Link
                    className={styles.nestedActivityRow}
                    href={`/teacher/activities/new?wc=${copy.id}`}
                    key={copy.id}
                  >
                    <span className={styles.activityTitle}>
                      {copy.title.trim() || "未命名任务书"}
                    </span>
                    <span className={styles.activityMeta}>
                      还没保存为版本 · 还差 {copy.gapCount} 项 ·{" "}
                      <LocalizedDateTime dateTime={copy.savedAt} /> 自动保存
                    </span>
                    <span className={styles.activityStatus}>
                      <span className={styles.statusBadge} data-tone="editing">
                        未完成
                      </span>
                    </span>
                  </Link>
                ))}
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
                        {unsavedByDraft.has(draft.id) ? " · 有没保存的修改" : ""}
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
