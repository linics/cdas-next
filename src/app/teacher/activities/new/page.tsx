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
            <h1>新建跨学科任务</h1>
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
