import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  getTeacherIdentity,
  TeacherActivityQueryError,
} from "../../../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
  activityStudioCrumb,
  teacherHomeCrumb,
} from "../../_components/teacher-shell";
import { ActivityDraftForm } from "../activity-draft-form";
import { emptyActivityDraftValues } from "../activity-draft-action-state";
import styles from "../../teacher-workspace.module.css";

export default async function NewTeacherActivityPage() {
  let actor;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    actor = await getTeacherIdentity(database, context, {});
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <TeacherAccessGate
          code={error.code}
          returnPath="/teacher/activities/new"
        />
      );
    }
    if (
      error instanceof TeacherActivityQueryError ||
      error instanceof ZodError
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <TeacherPage
      actorName={actor.displayName}
      breadcrumb={[teacherHomeCrumb, activityStudioCrumb, { label: "新建" }]}
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>跨学科任务 / 新草稿</p>
            <h1>新建跨学科任务</h1>
            <p>
              填写基本设置、三维目标、任务链与评价量规后保存草稿；可先保持编辑中，也可直接标记为可预览。
            </p>
          </div>
          <div className={styles.pageHeaderActions}>
            <Link className={styles.secondaryButton} href="/teacher/knowledge">
              检索课程标准
            </Link>
          </div>
        </header>
        <ActivityDraftForm
          initialState={{
            status: "idle",
            message: "",
            values: emptyActivityDraftValues,
            draftId: null,
            expectedVersion: null,
            persistedStatus: null,
            nextIdempotencyKey: `save_activity_draft_${randomUUID()}`,
          }}
        />
      </div>
    </TeacherPage>
  );
}
