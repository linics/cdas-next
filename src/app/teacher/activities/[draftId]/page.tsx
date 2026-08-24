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
import { structuredTaskBookValues } from "../activity-draft-action-state";
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
        {content.schemaVersion === 1 ? (
          <article className={styles.legacyReadPanel}>
            <header>
              <p className={styles.eyebrow}>历史 schema v1 · 原样只读</p>
              <h2>升级前先核对原活动内容</h2>
              <p>
                下面六段历史内容不会被伪造成新字段。请以它们为参考补齐任务书；成功保存后会追加一条 v2 修订，原修订保持不变。
              </p>
            </header>
            <section><h3>活动摘要</h3><p>{content.summary}</p></section>
            <section><h3>学习目标</h3><ol>{content.learningObjectives.map((item) => <li key={item}>{item}</li>)}</ol></section>
            <section><h3>任务说明</h3><p>{content.taskInstructions}</p></section>
            <section><h3>提交证据</h3><ul>{content.evidenceRequirements.map((item) => <li key={item}>{item}</li>)}</ul></section>
            <section><h3>反馈标准</h3><ul>{content.feedbackCriteria.map((item) => <li key={item}>{item}</li>)}</ul></section>
          </article>
        ) : null}
        <ActivityDraftForm
          initialState={{
            status: "idle",
            message: "",
            values: structuredTaskBookValues(content),
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
