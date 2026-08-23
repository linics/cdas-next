import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AuthenticationError } from "../../../../../server/auth/current-actor";
import { isActivityAssistantEnabled } from "../../../../../server/assistant/assistant-config";
import {
  getTeacherAssistantClassrooms,
  TeacherAssistantContextError,
  type AssistantClassroom,
} from "../../../../../server/assistant/teacher-assistant-context";
import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../../server/db/client";
import {
  getTeacherActivityPreview,
  TeacherActivityQueryError,
} from "../../../../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
} from "../../../_components/teacher-shell";
import { ActivityAssistant } from "../../../_components/activity-assistant";
import styles from "../../../teacher-workspace.module.css";
import { PublishPanel } from "./publish-panel";

export default async function TeacherActivityPreviewPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  let workspace;
  let assistantEnabled = false;
  let assistantClassrooms: AssistantClassroom[] = [];
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    assistantEnabled = isActivityAssistantEnabled();
    [workspace, assistantClassrooms] = await Promise.all([
      getTeacherActivityPreview(database, context, { draftId }),
      assistantEnabled
        ? getTeacherAssistantClassrooms(database, context)
        : Promise.resolve([]),
    ]);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <TeacherAccessGate
          code={error.code}
          returnPath={`/teacher/activities/${draftId}/preview`}
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

  const content = workspace.draft.revision.content;
  return (
    <TeacherPage actorName={workspace.actor.displayName}>
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>发布管理 / 精确版本预览</p>
            <h1>{content.title}</h1>
            <p>
              此页读取草稿版本 {workspace.draft.version} 的精确不可变修订。准备与确认不会采用浏览器提交的正文。
            </p>
          </div>
          <Link
            className={styles.secondaryButton}
            href={`/teacher/activities/${workspace.draft.id}`}
          >
            ← 返回草稿
          </Link>
        </header>

        <div className={styles.previewLayout}>
          <article className={styles.snapshotSheet}>
            <header>
              <p className={styles.eyebrow}>草稿修订 {workspace.draft.version}</p>
              <h2>{content.title}</h2>
              <p>{content.summary}</p>
            </header>
            <section>
              <h3>学习目标</h3>
              <ol>
                {content.learningObjectives.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </section>
            <section>
              <h3>任务说明</h3>
              <p>{content.taskInstructions}</p>
            </section>
            <section>
              <h3>提交证据</h3>
              <ul>
                {content.evidenceRequirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <section>
              <h3>教师反馈将关注</h3>
              <ul>
                {content.feedbackCriteria.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </article>

          <PublishPanel
            workspace={workspace}
            initialPreparationState={{
              status: "idle",
              message: "",
              confirmation: null,
              selectedClassroomId: workspace.classrooms[0]?.id ?? "",
              dueAtInstant: "",
              nextPrepareIdempotencyKey: `prepare_publish_${randomUUID()}`,
            }}
          />
        </div>
        {assistantEnabled ? (
          <ActivityAssistant
            classrooms={assistantClassrooms}
            continuationOnly
          />
        ) : null}
      </div>
    </TeacherPage>
  );
}
