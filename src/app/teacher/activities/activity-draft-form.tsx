"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { saveActivityDraftAction } from "./actions";
import type {
  ActivityDraftActionState,
  ActivityDraftFormValues,
} from "./activity-draft-action-state";
import styles from "../teacher-workspace.module.css";

const fields = [
  {
    key: "title",
    label: "活动标题",
    help: "学生与教师在工作台辨识活动时使用，最多 120 字。",
    kind: "input",
  },
  {
    key: "summary",
    label: "活动摘要",
    help: "用一段话交代活动目的与情境，最多 600 字。",
    kind: "textarea",
  },
  {
    key: "learningObjectives",
    label: "学习目标",
    help: "每行一项，保留 1–8 项可观察的学习结果。",
    kind: "textarea",
  },
  {
    key: "taskInstructions",
    label: "任务说明",
    help: "说明学生要完成的步骤、范围与交付方式。",
    kind: "long",
  },
  {
    key: "evidenceRequirements",
    label: "证据要求",
    help: "每行一项，说明正式提交中要包含哪些可核验证据。",
    kind: "textarea",
  },
  {
    key: "feedbackCriteria",
    label: "反馈标准",
    help: "每行一项，让学生知道教师将依据什么给予反馈。",
    kind: "textarea",
  },
] as const satisfies ReadonlyArray<{
  key: keyof ActivityDraftFormValues;
  label: string;
  help: string;
  kind: "input" | "textarea" | "long";
}>;

const statusLabels = {
  EDITING: "编辑中",
  READY_FOR_PREVIEW: "可预览",
  SEALED: "已封存",
} as const;

export function ActivityDraftForm({
  initialState,
}: {
  initialState: ActivityDraftActionState;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    saveActivityDraftAction,
    initialState,
  );
  const [values, setValues] = useState(initialState.values);
  const isSealed = state.persistedStatus === "SEALED";
  const isConflict = state.status === "conflict";
  const draftHref = state.draftId
    ? `/teacher/activities/${state.draftId}`
    : null;

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }
    if (initialState.draftId === null && state.draftId) {
      router.replace(`/teacher/activities/${state.draftId}`);
    }
  }, [initialState.draftId, router, state]);

  return (
    <div className={styles.editorLayout}>
      <form className={styles.editorForm} action={formAction}>
        <input type="hidden" name="draftId" value={state.draftId ?? ""} />
        <input
          type="hidden"
          name="expectedVersion"
          value={state.expectedVersion ?? ""}
        />
        <input
          type="hidden"
          name="idempotencyKey"
          value={state.nextIdempotencyKey}
        />

        {fields.map((field, index) => {
          const id = `activity-${field.key}`;
          const common = {
            id,
            name: field.key,
            value: values[field.key],
            readOnly: isSealed,
            onChange: (
              event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) =>
              setValues((current) => ({
                ...current,
                [field.key]: event.target.value,
              })),
          };
          return (
            <section className={styles.formSection} key={field.key}>
              <span className={styles.formIndex} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className={styles.formField}>
                <label htmlFor={id}>{field.label}</label>
                {field.kind === "input" ? (
                  <input {...common} maxLength={120} required />
                ) : (
                  <textarea
                    {...common}
                    data-long={field.kind === "long" ? "true" : "false"}
                    required
                  />
                )}
                <small>{field.help}</small>
              </div>
            </section>
          );
        })}

        {!isSealed ? (
          <div className={styles.actionStack}>
            <button
              className={styles.secondaryButton}
              type="submit"
              name="desiredStatus"
              value="EDITING"
              disabled={pending || isConflict}
            >
              {pending ? "正在保存…" : "保存为编辑中"}
            </button>
            <button
              className={styles.primaryButton}
              type="submit"
              name="desiredStatus"
              value="READY_FOR_PREVIEW"
              disabled={pending || isConflict}
            >
              {pending ? "正在保存…" : "保存并标记可预览"}
            </button>
          </div>
        ) : null}
      </form>

      <aside className={styles.editorRail} aria-label="草稿状态与下一步">
        <p className={styles.eyebrow}>草稿状态</p>
        <h2>
          {state.persistedStatus
            ? statusLabels[state.persistedStatus]
            : "尚未创建"}
        </h2>
        <p>
          {state.expectedVersion
            ? `当前以版本 ${state.expectedVersion} 为保存基准。每次成功保存都会追加不可变修订。`
            : "第一次保存会创建版本 1 与对应的不可变修订。"}
        </p>

        {state.status !== "idle" ? (
          <div
            className={styles.actionNotice}
            data-status={state.status}
            role={state.status === "success" ? "status" : "alert"}
            aria-live="polite"
          >
            <span aria-hidden="true">
              {state.status === "success"
                ? "✓"
                : state.status === "conflict"
                  ? "↻"
                  : "!"}
            </span>
            <p>{state.message}</p>
          </div>
        ) : null}

        {isConflict && draftHref ? (
          <Link
            className={styles.conflictLink}
            href={draftHref}
            target="_blank"
            rel="noreferrer"
          >
            在新标签页打开最新版本
          </Link>
        ) : null}

        <div className={styles.actionStack}>
          {state.draftId && state.persistedStatus === "READY_FOR_PREVIEW" ? (
            <Link
              className={styles.primaryLink}
              href={`/teacher/activities/${state.draftId}/preview`}
            >
              查看发布预览 <span aria-hidden="true">→</span>
            </Link>
          ) : null}
          {state.persistedStatus === "SEALED" && state.draftId ? (
            <Link
              className={styles.secondaryButton}
              href={`/teacher/activities/${state.draftId}/preview`}
            >
              查看已封存内容
            </Link>
          ) : null}
          <Link className={styles.secondaryButton} href="/teacher">
            返回教师工作台
          </Link>
        </div>
      </aside>
    </div>
  );
}
