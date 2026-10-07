import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  ActivityCopyError,
} from "../../../../server/activity/activity-copy-source";
import { getActivityDraftOrigin } from "../../../../server/queries/activity-copy-workspace";
import {
  getTeacherActivityDraft,
  TeacherActivityQueryError,
} from "../../../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
  activityStudioCrumb,
  teacherHomeCrumb,
} from "../../_components/teacher-shell";
import { ActivityDraftForm } from "../activity-draft-form";
import { ActivityDraftV3Form } from "../activity-draft-v3-form";
import { structuredTaskBookValues } from "../activity-draft-action-state";
import { styles } from "../../teacher-ui";
import { isActivityAssistantEnabled } from "../../../../server/assistant/assistant-config";
import { InlineAlert } from "../../../_components/ui";
import { AdaptationPanel } from "./adaptation-panel";
import { SourceReferences } from "./source-references";
import { DraftDiagnosis } from "./draft-diagnosis";
import { getDraftDiagnoses } from "../../../../server/queries/activity-draft-diagnoses";
import { getActivitySourceReferences } from "../../../../server/queries/activity-source-references";
import { getDraftOriginSignals } from "../../../../server/queries/release-task-book-signals";
import { OriginSignals } from "./origin-signals";
import { getOwnDraftWorkingCopy } from "../../../../server/queries/activity-draft-working-copy";

export default async function TeacherActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { draftId } = await params;
  const query = await searchParams;
  const adapted = query?.adapted === "1";
  const restoreRequested = query?.restore === "working-copy";
  let workspace;
  let origin: Awaited<ReturnType<typeof getActivityDraftOrigin>> = null;
  let originError = false;
  let sources: Awaited<ReturnType<typeof getActivitySourceReferences>> = null;
  let diagnoses: Awaited<ReturnType<typeof getDraftDiagnoses>> = null;
  let originSignals: Awaited<ReturnType<typeof getDraftOriginSignals>> = null;
  let unsaved: Awaited<ReturnType<typeof getOwnDraftWorkingCopy>> = null;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    workspace = await getTeacherActivityDraft(database, context, { draftId });
    unsaved = await getOwnDraftWorkingCopy(database, context, draftId);
    sources = await getActivitySourceReferences(database, context, draftId);
    diagnoses = await getDraftDiagnoses(database, context, draftId);
    try {
      originSignals = await getDraftOriginSignals(database, context, draftId);
    } catch {
      // The signals are a reading aid from another release; the draft must
      // stay editable when they cannot be read.
      originSignals = null;
    }
    try {
      origin = await getActivityDraftOrigin(database, context, draftId);
    } catch (error) {
      if (error instanceof ActivityCopyError) {
        originError = true;
      } else {
        throw error;
      }
    }
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
  // D-093: unsaved edits made on this version reopen as they were. Edits made
  // on an older version wait until the teacher chooses between the two.
  const continuing =
    unsaved && draft.status !== "SEALED" && content.schemaVersion === 3 &&
    (unsaved.baseVersion === draft.version || restoreRequested)
      ? unsaved
      : null;
  const pendingCopy =
    unsaved && !continuing && draft.status !== "SEALED" && content.schemaVersion === 3
      ? unsaved
      : null;
  return (
    <TeacherPage
      actorName={workspace.actor.displayName}
      breadcrumb={[
        teacherHomeCrumb,
        activityStudioCrumb,
        { label: content.title },
      ]}
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <h1>{content.title}</h1>
            <p>
              当前内容创建于{" "}
              <LocalizedDateTime dateTime={draft.revision.createdAt} />
              ；每次保存都会生成新版本，历史版本保留。
            </p>
          </div>
          {content.schemaVersion === 3 ? (
            <div className="flex flex-wrap gap-2">
              <Link
                className={styles.secondaryButton}
                href={`/print/drafts/${draft.id}?version=${draft.version}`}
              >
                打印第 {draft.version} 版
              </Link>
              {draft.status !== "SEALED" ? (
                <Link
                  className={styles.secondaryButton}
                  href={`/teacher/activities/copy?kind=DRAFT&id=${draft.id}&version=${draft.version}`}
                >
                  复制为新活动
                </Link>
              ) : null}
            </div>
          ) : null}
        </header>
        {origin ? (
          <p className="flex w-fit items-center gap-2 rounded-lg border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground">
            来源活动：{origin.kind === "DRAFT" ? "草稿" : "已发布快照"}「{origin.title}」· 版本 {origin.version}
          </p>
        ) : originError ? (
          <p className="w-fit rounded-lg border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground" role="status">
            来源信息暂时无法读取。
          </p>
        ) : null}
        {adapted && draft.revision.source === "AGENT" ? (
          <InlineAlert tone="success">
            AI 适配已写入为第 {draft.version} 版，原版本保留在历史中。可继续在下方修改，发布前请预览核对。
          </InlineAlert>
        ) : null}
        {content.schemaVersion === 3 &&
        draft.status !== "SEALED" &&
        isActivityAssistantEnabled() ? (
          <AdaptationPanel
            applyIdempotencyKey={`apply_activity_adaptation_${randomUUID()}`}
            currentGrade={content.grade}
            currentLessons={content.phases.reduce(
              (sum, phase) => sum + phase.suggestedLessons,
              0,
            )}
            draftId={draft.id}
            key={`adaptation-${draft.version}`}
            version={draft.version}
          />
        ) : null}
        {content.schemaVersion === 3 && sources ? (
          <SourceReferences
            currentVersion={sources.currentVersion}
            draftId={draft.id}
            editable={draft.status !== "SEALED"}
            references={sources.references}
          />
        ) : null}
        {content.schemaVersion === 3 && draft.status !== "SEALED" && originSignals ? (
          <OriginSignals
            origin={originSignals}
            usedByDiagnosis={isActivityAssistantEnabled()}
          />
        ) : null}
        {content.schemaVersion === 3 && diagnoses ? (
          <DraftDiagnosis
            canDiagnose={draft.status !== "SEALED" && isActivityAssistantEnabled()}
            currentVersion={draft.version}
            diagnoses={diagnoses}
            draftId={draft.id}
          />
        ) : null}
        {content.schemaVersion === 1 ? (
          <article className={styles.legacyReadPanel}>
            <header>
              <p className={styles.eyebrow}>旧版内容 · 只读</p>
              <h2>升级前先核对原活动内容</h2>
              <p>
                以下为原活动内容，仅供参考。请据此补齐新版任务书；保存后原内容仍会保留。
              </p>
            </header>
            <section><h3>活动摘要</h3><p>{content.summary}</p></section>
            <section><h3>学习目标</h3><ol>{content.learningObjectives.map((item) => <li key={item}>{item}</li>)}</ol></section>
            <section><h3>任务说明</h3><p>{content.taskInstructions}</p></section>
            <section><h3>提交证据</h3><ul>{content.evidenceRequirements.map((item) => <li key={item}>{item}</li>)}</ul></section>
            <section><h3>反馈标准</h3><ul>{content.feedbackCriteria.map((item) => <li key={item}>{item}</li>)}</ul></section>
          </article>
        ) : null}
        {content.schemaVersion === 3 ? (
          <ActivityDraftV3Form
            key={`form-${draft.version}-${continuing?.id ?? "saved"}`}
            workingCopy={continuing}
            pendingCopy={pendingCopy}
            initialState={{
              status: "idle",
              message: "",
              values: continuing?.content ?? content,
              draftId: draft.id,
              expectedVersion: draft.version,
              persistedStatus: draft.status,
              nextIdempotencyKey: `save_activity_draft_${randomUUID()}`,
            }}
          />
        ) : (
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
        )}
      </div>
    </TeacherPage>
  );
}
