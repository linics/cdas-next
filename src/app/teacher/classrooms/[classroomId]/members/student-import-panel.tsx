"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { LocalizedDateTime } from "../../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert } from "../../../../_components/ui";
import styles from "../../../teacher-workspace.module.css";
import {
  decideStudentImportAction,
  previewStudentImportAction,
  type StudentImportPrepared,
  type StudentImportPreviewActionResult,
  type StudentImportReportRow,
} from "./actions";

type Preview = Extract<StudentImportPreviewActionResult, { ok: true }>;

const rowLabels: Readonly<Record<string, string>> = {
  CREATE: "新建账号并加入本班",
  REUSE: "已有账号，加入本班",
  ALREADY_CURRENT: "已在本班，跳过",
  CONFLICT_OTHER_CLASSROOM: "已属于本校其他班级，不导入",
  CONFLICT_SCHEDULED: "已有未来生效的班级关系，不导入",
  CONFLICT_NOT_STUDENT: "该学号已被非学生账号占用",
  CONFLICT_DISABLED: "账号已停用，请联系管理员",
  STUDENT_NO_INVALID: "学号必须是 6–32 位数字",
  DISPLAY_NAME_INVALID: "姓名为空或超过 120 个字符",
  DUPLICATE_STUDENT_NO: "同一文件中学号重复",
};

function rowTone(row: StudentImportReportRow): "ready" | "skip" | "blocked" {
  if (row.kind === "FILE_ISSUE") return "blocked";
  if (row.status === "CREATE" || row.status === "REUSE") return "ready";
  if (row.status === "ALREADY_CURRENT") return "skip";
  return "blocked";
}

export function StudentImportPanel({
  classroomId,
}: Readonly<{ classroomId: string }>) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [prepared, setPrepared] = useState<StudentImportPrepared | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function previewFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setPrepared(null);
    setConfirmationOpen(false);
    const formData = new FormData(event.currentTarget);
    formData.set("idempotencyKey", `prepare_student_import_${crypto.randomUUID()}`);
    const result = await previewStudentImportAction(formData);
    if (result.ok) {
      setPreview(result);
      setPrepared(result.prepared);
    }
    else {
      setPreview(null);
      setPrepared(null);
      setMessage(result.message);
    }
    setBusy(false);
  }

  function openConfirmation() {
    if (!prepared) return;
    setConfirmationOpen(true);
  }

  async function decide(decision: "CONFIRM" | "REJECT") {
    if (!prepared) return;
    setBusy(true);
    const result = await decideStudentImportAction({
      actionIntentId: prepared.confirmation.actionIntentId,
      decision,
      idempotencyKey: prepared.applyIdempotencyKey,
    });
    setConfirmationOpen(false);
    setPrepared(null);
    setMessage(result.message);
    if (result.ok && result.status === "APPLIED") {
      setPreview(null);
      router.refresh();
    }
    setBusy(false);
  }

  const confirmation = prepared?.confirmation;
  const createCount = confirmation?.entries.filter((entry) => entry.status === "CREATE").length ?? 0;
  const reuseCount = confirmation?.entries.filter((entry) => entry.status === "REUSE").length ?? 0;
  const blockedCount = preview?.rows.filter((row) => rowTone(row) === "blocked").length ?? 0;

  return (
    <section className={styles.importSection} id="student-import-panel" aria-labelledby="student-import-title">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>逐行预览后确认</p>
          <h2 id="student-import-title">从 Excel 导入学生</h2>
        </div>
      </header>
      <div className={styles.importSectionLead}>
        <p>
          按模板填写「学号、姓名」两列，一次最多 100 行。学号是本校内唯一的学生编号；
          已有账号只会加入本班，不会被改名或改密码。系统只保留解析后的名单，不保存上传的文件。
        </p>
      </div>
      <details className={styles.importDisclosure}>
        <summary>打开导入工具</summary>
        <div className={styles.importDisclosureBody}>
        <p>
          新建账号的初始密码是 <code>cdas</code> + 学号（例如学号 20260001 的初始密码为
          <code> cdas20260001</code>），学生首次登录必须修改。
        </p>
        <a className={styles.secondaryButton} href="/api/teacher/student-roster-template">
          下载 Excel 模板
        </a>
        <form className={styles.importForm} onSubmit={previewFile}>
          <input name="classroomId" type="hidden" value={classroomId} />
          <label htmlFor="student-roster-file">学生名单 Excel 文件</label>
          <input
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="学生名单 Excel 文件"
            disabled={busy}
            id="student-roster-file"
            name="file"
            required
            type="file"
          />
          <button className={styles.secondaryButton} disabled={busy} type="submit">
            {busy ? "正在解析…" : "解析并预览"}
          </button>
        </form>

        {preview ? (
          <div className={styles.rosterPreview}>
            <h3>导入预览</h3>
            <p>
              共 {preview.rows.length} 行，可导入 {preview.importable.length} 名；
              其余 {preview.rows.length - preview.importable.length} 行不会被导入。
            </p>
            <ul className={styles.importReport}>
              {preview.rows.map((row) => (
                <li
                  data-tone={rowTone(row)}
                  key={row.rowNumber}
                >
                  <strong>第 {row.rowNumber} 行</strong>
                  <span>
                    {row.kind === "FILE_ISSUE"
                      ? `${row.studentNoText || "（空学号）"} · ${row.displayNameText || "（空姓名）"}`
                      : `${row.studentNo} · ${row.displayName}`}
                  </span>
                  <span>
                    {row.kind === "FILE_ISSUE"
                      ? rowLabels[row.issue]
                      : rowLabels[row.status]}
                    {row.kind === "CLASSIFIED" && row.existingDisplayName
                      ? `（系统内姓名：${row.existingDisplayName}，本次不会改名）`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
            {blockedCount > 0 ? (
              <InlineAlert tone="warning">
                有 {blockedCount} 行无法导入。可以先导入其余学生，也可以修正文件后重新上传。
              </InlineAlert>
            ) : null}
            <button
              className={styles.secondaryButton}
              disabled={busy || !prepared}
              onClick={openConfirmation}
              type="button"
            >
              查看并确认导入 {preview.importable.length} 名学生
            </button>
          </div>
        ) : null}
        {message ? (
          <InlineAlert tone={message.startsWith("已完成") || message.startsWith("已取消") ? "info" : "warning"}>
            {message}
          </InlineAlert>
        ) : null}
        </div>
      </details>

      <ConfirmDialog
        confirmLabel="确认导入"
        detail={confirmation ? (
          <div className={styles.dialogDetail}>
            <p>班级：{confirmation.classroomName}</p>
            <p>
              将新建账号 {createCount} 个，并把共 {confirmation.entries.length} 名学生加入本班。
            </p>
            <p>新建账号的初始密码为 <code>cdas</code> + 学号，学生首次登录必须修改；已有的 {reuseCount} 个账号保持原有姓名和密码。</p>
            <p>确认有效至 <LocalizedDateTime dateTime={confirmation.expiresAt} includeSeconds />。</p>
            <p>参数摘要：<code>{confirmation.payloadHash}</code></p>
          </div>
        ) : null}
        disabled={busy}
        onCancel={() => decide("REJECT")}
        onConfirm={() => decide("CONFIRM")}
        open={confirmationOpen && Boolean(confirmation)}
        pending={busy}
        title="确认导入学生"
        tone="primary"
      />
    </section>
  );
}
