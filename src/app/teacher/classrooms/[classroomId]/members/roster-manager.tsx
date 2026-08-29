"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { LocalizedDateTime } from "../../../../_components/localized-date-time";
import { ConfirmDialog, InlineAlert } from "../../../../_components/ui";
import type { TeacherClassroomRoster } from "../../../../../server/queries/teacher-classroom-roster";
import styles from "../../../teacher-workspace.module.css";
import {
  decideRosterChangeAction,
  prepareEndMembershipAction,
  prepareRosterImportAction,
  previewRosterImportAction,
  type RosterPrepareActionResult,
  type RosterPreviewActionResult,
} from "./actions";

type Prepared = Extract<RosterPrepareActionResult, { ok: true }>;

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
  const [message, setMessage] = useState<string | null>(null);
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

  async function preview() {
    setBusy(true);
    setMessage(null);
    const result = await previewRosterImportAction({
      classroomId: roster.classroom.id,
      rosterText,
    });
    setPreviewResult(result);
    if (!result.ok) setMessage(result.message);
    setBusy(false);
  }

  async function prepareAdd() {
    setBusy(true);
    setMessage(null);
    const result = await prepareRosterImportAction({
      classroomId: roster.classroom.id,
      rosterKeys: readyKeys,
      idempotencyKey: `prepare_roster_${crypto.randomUUID()}`,
    });
    if (result.ok) setPrepared(result);
    else setMessage(result.message);
    setBusy(false);
  }

  async function prepareEnd(membershipId: string) {
    setBusy(true);
    setMessage(null);
    const result = await prepareEndMembershipAction({
      classroomId: roster.classroom.id,
      membershipId,
      idempotencyKey: `prepare_roster_${crypto.randomUUID()}`,
    });
    if (result.ok) setPrepared(result);
    else setMessage(result.message);
    setBusy(false);
  }

  async function decide(decision: "CONFIRM" | "REJECT") {
    if (!prepared) return;
    setBusy(true);
    const result = await decideRosterChangeAction({
      actionIntentId: prepared.confirmation.actionIntentId,
      decision,
      idempotencyKey: prepared.applyIdempotencyKey,
    });
    setPrepared(null);
    setMessage(result.message);
    if (result.ok && result.status === "APPLIED") {
      setRosterText("");
      setPreviewResult(null);
      router.refresh();
    }
    setBusy(false);
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
          <p className={styles.emptyState}>当前没有有效成员，可通过右侧名单码导入。</p>
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
      </section>

      <section className={styles.rosterImportPanel} aria-labelledby="roster-import-title">
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
        {message ? <InlineAlert tone={message.includes("已") ? "info" : "warning"}>{message}</InlineAlert> : null}
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
