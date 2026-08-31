"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, useMemo, useState, useSyncExternalStore } from "react";
import type { StudentRosterEntry } from "../../../../../domain/classroom/student-roster-xlsx";
import { LocalizedDateTime } from "../../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert } from "../../../../_components/ui";
import type { TeacherClassroomRoster } from "../../../../../server/queries/teacher-classroom-roster";
import styles from "../../../teacher-workspace.module.css";
import {
  decideRosterChangeAction,
  prepareEndMembershipAction,
  prepareRosterImportAction,
  prepareStudentImportAction,
  previewStudentImportAction,
  decideStudentImportAction,
  previewRosterImportAction,
  type RosterPrepareActionResult,
  type RosterPreviewActionResult,
  type StudentImportPrepareActionResult,
} from "./actions";

type Prepared = Extract<RosterPrepareActionResult, { ok: true }>;
type StudentImportPrepared = Extract<StudentImportPrepareActionResult, { ok: true }>;
type Feedback = Readonly<{
  text: string;
  tone: "info" | "warning" | "danger" | "success";
}>;

const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

export function RosterManager({
  roster,
}: Readonly<{ roster: TeacherClassroomRoster }>) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    hydratedSnapshot,
    serverSnapshot,
  );
  const [rosterText, setRosterText] = useState("");
  const [previewResult, setPreviewResult] = useState<RosterPreviewActionResult | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [studentEntries, setStudentEntries] = useState<StudentRosterEntry[] | null>(null);
  const [studentPrepared, setStudentPrepared] = useState<StudentImportPrepared | null>(null);
  const [message, setMessage] = useState<Feedback | null>(null);
  const [studentFileName, setStudentFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentMemberships = roster.memberships.filter((membership) => membership.status === "CURRENT");
  const historicalMemberships = roster.memberships.filter((membership) => membership.status !== "CURRENT");
  const readyKeys = useMemo(
    () => previewResult?.ok
      ? previewResult.preview.entries.filter((entry) => entry.status === "READY").map((entry) => entry.rosterKey)
      : [],
    [previewResult],
  );
  const previewIsFullyReady = Boolean(
    previewResult?.ok &&
      previewResult.duplicates.length === 0 &&
      readyKeys.length === previewResult.preview.entries.length,
  );

  function unexpectedFailure(): Feedback {
    return {
      tone: "danger",
      text: "连接服务器时未能完成操作，现有班级成员没有被假设为已改变。请刷新页面后重试。",
    };
  }

  async function preview() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await previewRosterImportAction({
        classroomId: roster.classroom.id,
        rosterText,
      });
      setPreviewResult(result);
      if (!result.ok) setMessage({ tone: "warning", text: result.message });
    } catch {
      setPreviewResult(null);
      setMessage(unexpectedFailure());
    } finally {
      setBusy(false);
    }
  }

  async function prepareAdd() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await prepareRosterImportAction({
        classroomId: roster.classroom.id,
        rosterKeys: readyKeys,
        idempotencyKey: `prepare_roster_${crypto.randomUUID()}`,
      });
      if (result.ok) setPrepared(result);
      else setMessage({ tone: "warning", text: result.message });
    } catch {
      setMessage(unexpectedFailure());
    } finally {
      setBusy(false);
    }
  }

  async function prepareEnd(membershipId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await prepareEndMembershipAction({
        classroomId: roster.classroom.id,
        membershipId,
        idempotencyKey: `prepare_roster_${crypto.randomUUID()}`,
      });
      if (result.ok) setPrepared(result);
      else setMessage({ tone: "warning", text: result.message });
    } catch {
      setMessage(unexpectedFailure());
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "CONFIRM" | "REJECT") {
    if (!prepared) return;
    setBusy(true);
    try {
      const result = await decideRosterChangeAction({
        actionIntentId: prepared.confirmation.actionIntentId,
        decision,
        idempotencyKey: prepared.applyIdempotencyKey,
      });
      setPrepared(null);
      setMessage({
        tone: result.ok && result.status === "APPLIED" ? "success" : result.ok ? "info" : "warning",
        text: result.message,
      });
      if (result.ok && result.status === "APPLIED") {
        setRosterText("");
        setPreviewResult(null);
        router.refresh();
      }
    } catch {
      setMessage(unexpectedFailure());
    } finally {
      setBusy(false);
    }
  }

  async function previewStudentFile(file: File) {
    setBusy(true);
    setMessage(null);
    setStudentPrepared(null);
    setStudentEntries(null);
    const formData = new FormData();
    formData.set("file", file);
    try {
      const result = await previewStudentImportAction(formData);
      if (result.ok) {
        setStudentEntries(result.entries);
        setMessage({ tone: "info", text: `已解析 ${result.entries.length} 名学生，请在左侧核对后继续。` });
      } else {
        setMessage({ tone: "warning", text: result.message });
      }
    } catch {
      setMessage(unexpectedFailure());
    } finally {
      setBusy(false);
    }
  }

  function selectStudentFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.item(0);
    if (!file) return;
    event.currentTarget.value = "";
    setStudentFileName(file.name);
    void previewStudentFile(file);
  }

  async function prepareStudentImport() {
    if (!studentEntries) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await prepareStudentImportAction({ classroomId: roster.classroom.id, entries: studentEntries, idempotencyKey: `prepare_student_import_${crypto.randomUUID()}` });
      if (result.ok) setStudentPrepared(result);
      else setMessage({ tone: "warning", text: result.message });
    } catch {
      setMessage(unexpectedFailure());
    } finally {
      setBusy(false);
    }
  }

  async function decideStudentImport(decision: "CONFIRM" | "REJECT") {
    if (!studentPrepared) return;
    setBusy(true);
    try {
      const result = await decideStudentImportAction({ actionIntentId: studentPrepared.confirmation.actionIntentId, decision, idempotencyKey: studentPrepared.applyIdempotencyKey });
      setStudentPrepared(null);
      setMessage({
        tone: result.ok && result.status === "APPLIED" ? "success" : result.ok ? "info" : "warning",
        text: result.message,
      });
      if (result.ok && result.status === "APPLIED") {
        setStudentEntries(null);
        setStudentFileName(null);
        router.refresh();
      }
    } catch {
      setMessage(unexpectedFailure());
    } finally {
      setBusy(false);
    }
  }

  const confirmation = prepared?.confirmation;
  const confirmationStudents = confirmation?.operation === "ADD"
    ? confirmation.students.map((student) => student.displayName).join("、")
    : confirmation?.student.displayName ?? "";

  return (
    <div
      className={styles.rosterLayout}
      data-hydrated={hydrated ? "true" : "false"}
      id="classroom-roster-manager"
    >
      <section className={styles.dashboardSection} aria-labelledby="current-roster-title">
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>当前名单</p>
            <h2 id="current-roster-title">当前成员</h2>
          </div>
          <span>{currentMemberships.length} 名</span>
        </header>
        {currentMemberships.length === 0 ? (
          <p className={styles.emptyState}>当前没有有效成员，可在右侧从 Excel 导入学生账号，或粘贴名单码。</p>
        ) : (
          <div className={styles.rosterList}>
            {currentMemberships.map((membership) => (
              <article className={styles.rosterRow} key={membership.id}>
                <div>
                  <h3>{membership.studentName}</h3>
                  <p>加入于 <LocalizedDateTime dateTime={membership.joinedAt} /></p>
                </div>
                <button
                  className={styles.dangerButton}
                  disabled={busy}
                  onClick={() => prepareEnd(membership.id)}
                  type="button"
                >
                  结束成员关系
                </button>
              </article>
            ))}
          </div>
        )}
        {message ? <InlineAlert tone={message.tone}>{message.text}</InlineAlert> : null}
        {studentEntries ? (
          <section className={styles.studentImportPreview} aria-labelledby="student-import-preview-title">
            <header className={styles.sectionHeader}>
              <div>
                <p className={styles.eyebrow}>Excel 导入预览</p>
                <h3 id="student-import-preview-title">待导入学生</h3>
              </div>
              <span>{studentEntries.length} 名</span>
            </header>
            <p>确认后才会创建账号并加入本班；请先核对学号和姓名。</p>
            <ul>{studentEntries.map((entry) => <li key={entry.studentNo}><strong>{entry.studentNo}</strong><span>{entry.displayName}</span></li>)}</ul>
            <button className={styles.primaryButton} disabled={busy} onClick={prepareStudentImport} type="button">确认预览，准备导入 {studentEntries.length} 名</button>
          </section>
        ) : null}
      </section>

      <section className={styles.rosterImportPanel} aria-labelledby="student-import-title">
        <p className={styles.eyebrow}>学生账号导入</p>
        <h2 id="student-import-title">从 Excel 创建学生账号</h2>
        <p>仅解析首个工作表，首行必须是“学号、姓名”。学号需为至少六位数字；系统不保存原始 Excel 文件，初始密码为学号后六位。</p>
        <a className={styles.secondaryButton} href="/api/teacher/student-import-template">下载 Excel 模板</a>
        <div className={styles.filePickerGroup}>
          <input accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className={styles.visuallyHidden} disabled={busy} id="student-roster-file" name="file" onChange={selectStudentFile} type="file" />
          <label aria-disabled={busy} className={`${styles.secondaryButton} ${styles.filePickerButton}`} htmlFor="student-roster-file">{busy ? "正在解析…" : "选择 Excel 文件"}</label>
          {studentFileName ? <p className={styles.fileName}>已选择：{studentFileName}</p> : null}
        </div>
        <p className={styles.filePickerHint}>选择后将自动解析，并在左侧成员区预览。</p>

        <ConfirmDialog
          detail={studentPrepared ? <div className={styles.dialogDetail}><p>班级：{studentPrepared.confirmation.classroomName}</p><p>本次将处理 {studentPrepared.confirmation.entries.length} 名学生，其中新建账号 {studentPrepared.confirmation.entries.filter((entry) => entry.status === "CREATE").length} 名、复用同校账号 {studentPrepared.confirmation.entries.filter((entry) => entry.status === "REUSE").length} 名。</p><p>已在本班的账号不会重复加入；若账号当前属于其他班级，系统会拒绝导入并保持零写入。</p><p>确认有效至 <LocalizedDateTime dateTime={studentPrepared.confirmation.expiresAt} includeSeconds />。</p><p>参数摘要：<code>{studentPrepared.confirmation.payloadHash}</code></p></div> : null}
          disabled={busy}
          confirmLabel="确认创建账号并加入班级"
          onCancel={() => decideStudentImport("REJECT")}
          onConfirm={() => decideStudentImport("CONFIRM")}
          open={Boolean(studentPrepared)}
          pending={busy}
          title="确认学生账号导入"
          tone="primary"
        />

        <hr />
        <p className={styles.eyebrow}>受控批量加入</p>
        <h2 id="roster-import-title">粘贴学生名单码</h2>
        <p>每行一个或用逗号分隔，最多 50 个；仅匹配已由管理员配置的学生账号。</p>
        <textarea
          aria-label="学生名单码"
          disabled={busy}
          onChange={(event) => {
            setRosterText(event.target.value);
            setPreviewResult(null);
          }}
          placeholder="例如：STUDENT8A01"
          rows={7}
          value={rosterText}
        />
        <button className={styles.secondaryButton} disabled={busy || !rosterText.trim()} onClick={preview} type="button">
          {busy ? "正在处理…" : "预览名单"}
        </button>

        {previewResult?.ok ? (
          <div className={styles.rosterPreview}>
            <h3>预览结果</h3>
            <ul>
              {previewResult.preview.entries.map((entry) => (
                <li key={entry.rosterKey} data-status={entry.status}>
                  <strong>{entry.rosterKey}</strong>
                  <span>
                    {entry.status === "READY"
                      ? `${entry.studentName} · 可加入`
                      : entry.status === "ALREADY_CURRENT"
                        ? `${entry.studentName} · 已在班`
                        : entry.status === "INTERVAL_CONFLICT"
                          ? `${entry.studentName} · 存在冲突区间`
                          : "无法匹配"}
                  </span>
                </li>
              ))}
            </ul>
            {previewResult.duplicates.length > 0 ? (
              <InlineAlert tone="warning">重复名单码：{previewResult.duplicates.join("、")}</InlineAlert>
            ) : null}
            <button className={styles.primaryButton} disabled={busy || !previewIsFullyReady} onClick={prepareAdd} type="button">
              准备加入 {readyKeys.length} 名学生
            </button>
            {!previewIsFullyReady ? <p>请先修正无法匹配、重复或已在班的项目，再重新预览。</p> : null}
          </div>
        ) : null}
      </section>

      {historicalMemberships.length > 0 ? (
        <section className={styles.dashboardSection} aria-labelledby="historical-roster-title">
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>历史记录</p>
              <h2 id="historical-roster-title">历史成员</h2>
            </div>
            <span>{historicalMemberships.length} 条</span>
          </header>
          <div className={styles.rosterList}>
            {historicalMemberships.map((membership) => (
              <article className={styles.rosterRow} key={membership.id}>
                <div>
                  <h3>{membership.studentName}</h3>
                  <p>
                    <LocalizedDateTime dateTime={membership.joinedAt} /> 至 {membership.endedAt ? <LocalizedDateTime dateTime={membership.endedAt} /> : "今"}
                  </p>
                </div>
                <span className={styles.statusBadge} data-tone="sealed">已保留</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.operation === "ADD" ? "确认加入班级成员" : "确认结束成员关系"}
        detail={confirmation ? (
          <div className={styles.dialogDetail}>
            <p>班级：{confirmation.classroomName}</p>
            <p>学生：{confirmationStudents}</p>
            <p>{confirmation.operation === "ADD" ? "将把以上学生加入当前成员名单。" : "将结束该学生的当前成员关系；其历史活动与提交记录会保留。"}</p>
            <p>确认有效至 <LocalizedDateTime dateTime={confirmation.expiresAt} includeSeconds />。</p>
            <p>参数摘要：<code>{confirmation.payloadHash}</code></p>
          </div>
        ) : null}
        confirmLabel={confirmation?.operation === "ADD" ? "确认加入" : "确认结束关系"}
        tone={confirmation?.operation === "END" ? "danger" : "primary"}
        pending={busy}
        disabled={busy}
        onCancel={() => decide("REJECT")}
        onConfirm={() => decide("CONFIRM")}
      />
    </div>
  );
}
