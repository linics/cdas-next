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
import { getOwnNewTaskBookWorkingCopy } from "../../../../server/queries/activity-draft-working-copy";
import { ActivityDraftV3Form } from "../activity-draft-v3-form";
import { emptyActivityDraftV3Values } from "../activity-draft-v3-state";
import { styles } from "../../teacher-ui";
import { InlineAlert } from "../../../_components/ui";

export default async function NewTeacherActivityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = (await searchParams)?.wc;
  const workingCopyId =
    typeof requested === "string" && /^[0-9a-f-]{36}$/u.test(requested) ? requested : null;
  let actor;
  let workingCopy: Awaited<ReturnType<typeof getOwnNewTaskBookWorkingCopy>> = null;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    actor = await getTeacherIdentity(database, context, {});
    // D-093: an unfinished task book reopens where the teacher left it.
    if (workingCopyId) {
      workingCopy = await getOwnNewTaskBookWorkingCopy(database, context, workingCopyId);
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <TeacherAccessGate
          code={error.code}
          returnPath={
            workingCopyId ? `/teacher/activities/new?wc=${workingCopyId}` : "/teacher/activities/new"
          }
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
            <p>
              每条学习目标都要关联课标核心素养，并有阶段承担、有量规评价。
            </p>
          </div>
          <div className={styles.pageHeaderActions}>
            <Link className={styles.secondaryButton} href="/teacher/knowledge">
              检索课程标准
            </Link>
          </div>
        </header>
        {workingCopyId && !workingCopy ? (
          <InlineAlert tone="warning">
            没有找到这份没保存的任务书：它可能已经保存为草稿或被删除。下面是一份新的空白任务书。
          </InlineAlert>
        ) : null}
        <ActivityDraftV3Form
          key={workingCopy?.id ?? "blank"}
          workingCopy={workingCopy}
          initialState={{
            status: "idle",
            message: "",
            values: workingCopy?.content ?? emptyActivityDraftV3Values,
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
