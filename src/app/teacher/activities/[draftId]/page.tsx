import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  getTeacherActivityDraft,
  TeacherActivityQueryError,
} from "../../../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
} from "../../_components/teacher-shell";
import { ActivityDraftForm } from "../activity-draft-form";
import styles from "../../teacher-workspace.module.css";

export default async function TeacherActivityPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  let workspace;
  try {
    const context = await createUiCommandContext();
    workspace = await getTeacherActivityDraft(
      getDatabaseClient(),
      context,
      { draftId },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <TeacherAccessGate
          code={error.code}
          returnPath={`/teacher/activities/${draftId}`}
        />
      );
    }
    if (error instanceof TeacherActivityQueryError || error instanceof ZodError) {
      notFound();
    }
    throw error;
  }

  const { draft } = workspace;
  const content = draft.revision.content;
  return (
    <TeacherPage actorName={workspace.actor.displayName}>
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>活动设计 / 草稿版本 {draft.version}</p>
            <h1>{content.title}</h1>
            <p>
              当前页面读取不可变修订 {draft.revision.version}，于{" "}
              <LocalizedDateTime dateTime={draft.revision.createdAt} /> 创建。
              成功保存才会前进版本。
            </p>
          </div>
        </header>
        <ActivityDraftForm
          initialState={{
            status: "idle",
            message: "",
            values: {
              title: content.title,
              summary: content.summary,
              learningObjectives: content.learningObjectives.join("\n"),
              taskInstructions: content.taskInstructions,
              evidenceRequirements: content.evidenceRequirements.join("\n"),
              feedbackCriteria: content.feedbackCriteria.join("\n"),
            },
            draftId: draft.id,
            expectedVersion: draft.version,
            persistedStatus: draft.status,
            nextIdempotencyKey: `save_activity_draft_${randomUUID()}`,
          }}
        />
      </div>
    </TeacherPage>
  );
}
