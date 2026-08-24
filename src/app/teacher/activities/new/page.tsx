import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import {
  isActivityAssistantEnabled,
} from "../../../../server/assistant/assistant-config";
import {
  getTeacherAssistantClassrooms,
  TeacherAssistantContextError,
  type AssistantClassroom,
} from "../../../../server/assistant/teacher-assistant-context";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  getTeacherIdentity,
  TeacherActivityQueryError,
} from "../../../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
} from "../../_components/teacher-shell";
import { ActivityAssistant } from "../../_components/activity-assistant";
import { ActivityDraftForm } from "../activity-draft-form";
import { emptyActivityDraftValues } from "../activity-draft-action-state";
import styles from "../../teacher-workspace.module.css";

export default async function NewTeacherActivityPage() {
  let actor;
  let assistantEnabled = false;
  let assistantClassrooms: AssistantClassroom[] = [];
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    assistantEnabled = isActivityAssistantEnabled();
    [actor, assistantClassrooms] = await Promise.all([
      getTeacherIdentity(database, context, {}),
      assistantEnabled
        ? getTeacherAssistantClassrooms(database, context)
        : Promise.resolve([]),
    ]);
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
      error instanceof TeacherAssistantContextError ||
      error instanceof ZodError
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <TeacherPage actorName={actor.displayName}>
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>活动设计 / 新草稿</p>
            <h1>创建第一个完整版本</h1>
            <p>
              基本设置、三维目标、任务链、证据与评价会在一次保存中形成草稿当前内容与完全一致的不可变修订；可先保持编辑中，也可直接标记为可预览。
            </p>
          </div>
        </header>
        {assistantEnabled ? (
          <ActivityAssistant classrooms={assistantClassrooms} />
        ) : null}
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
