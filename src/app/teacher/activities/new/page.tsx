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
import { ActivityDraftV3Form } from "../activity-draft-v3-form";
import { emptyActivityDraftV3Values } from "../activity-draft-v3-state";
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
              每条学习目标关联官方课程标准的核心素养，并由某个阶段承担、某个评价维度评价。保存后可先保持编辑中，也可直接标记为可预览。
            </p>
          </div>
          <div className={styles.pageHeaderActions}>
            <Link className={styles.secondaryButton} href="/teacher/knowledge">
              检索课程标准
            </Link>
          </div>
        </header>
        <ActivityDraftV3Form
          initialState={{
            status: "idle",
            message: "",
            values: emptyActivityDraftV3Values,
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
