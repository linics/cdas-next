"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, InlineAlert } from "../../../../_components/ui";
import type { TeacherReleaseSubmissions } from "../../../../../server/queries/submission-workspace";
import styles from "../../../teacher-workspace.module.css";
import {
  deleteReleaseGroupAction,
  saveReleaseGroupAction,
} from "./group-actions";

type Progress = TeacherReleaseSubmissions["progress"][number];
type GroupProgress = Progress & { group: NonNullable<Progress["group"]> };
type PendingDecision =
  | Readonly<{
      kind: "SAVE";
      input: Parameters<typeof saveReleaseGroupAction>[0];
      memberSummary: string;
    }>
  | Readonly<{
      kind: "DELETE";
      input: Parameters<typeof deleteReleaseGroupAction>[0];
      groupName: string;
    }>;

function hasGroup(progress: Progress): progress is GroupProgress {
  return progress.group !== null;
}

export function ReleaseGroupManager({
  releaseId,
  progress,
}: Readonly<{
  releaseId: string;
  progress: TeacherReleaseSubmissions["progress"];
}>) {
  const router = useRouter();
  const groups = progress.filter(hasGroup);
  const ungrouped = progress.filter((entry) => entry.group === null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [roleLabels, setRoleLabels] = useState<Record<string, string>>({});
  const [pendingDecision, setPendingDecision] =
    useState<PendingDecision | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const editingGroup = groups.find(
    (entry) => entry.group.id === editingGroupId,
  );
  const availableStudents = (() => {
    const students = new Map<
      string,
      { id: string; displayName: string; unavailable: boolean }
    >();
    for (const entry of ungrouped) {
      students.set(entry.student.id, {
        ...entry.student,
        unavailable: entry.started,
      });
    }
    for (const member of editingGroup?.group.members ?? []) {
      students.set(member.student.id, {
        ...member.student,
        unavailable: false,
      });
    }
    return [...students.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
  })();

  function resetEditor() {
    setEditorOpen(false);
    setEditingGroupId(null);
    setName("");
    setSelectedIds([]);
    setRoleLabels({});
  }

  function beginCreate() {
    setMessage(null);
    setEditingGroupId(null);
    setName("");
    setSelectedIds([]);
    setRoleLabels({});
    setEditorOpen(true);
  }

  function beginEdit(group: GroupProgress) {
    setMessage(null);
    setEditingGroupId(group.group.id);
    setName(group.group.name);
    setSelectedIds(group.group.members.map((member) => member.student.id));
    setRoleLabels(
      Object.fromEntries(
        group.group.members.map((member) => [
          member.student.id,
          member.roleLabel ?? "",
        ]),
      ),
    );
    setEditorOpen(true);
  }

  function toggleStudent(studentId: string) {
    setSelectedIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId],
    );
  }

  function prepareSave() {
    const trimmedName = name.trim();
    if (!trimmedName || selectedIds.length === 0) {
      setMessage("请填写小组名称，并至少选择一名尚未开始个人提交的学生。");
      return;
    }
    const members = selectedIds.map((studentId) => ({
      studentId,
      roleLabel: roleLabels[studentId]?.trim() || null,
    }));
    const memberSummary = members
      .map((member) => {
        const student = availableStudents.find(
          (candidate) => candidate.id === member.studentId,
        );
        return `${student?.displayName ?? "学生"}${
          member.roleLabel ? `（${member.roleLabel}）` : ""
        }`;
      })
      .join("、");
    setPendingDecision({
      kind: "SAVE",
      input: {
        releaseId,
        groupId: editingGroupId,
        name: trimmedName,
        members,
        idempotencyKey: `release_group_${crypto.randomUUID()}`,
      },
      memberSummary,
    });
  }

  async function confirmDecision() {
    if (!pendingDecision) return;
    setBusy(true);
    const result =
      pendingDecision.kind === "SAVE"
        ? await saveReleaseGroupAction(pendingDecision.input)
        : await deleteReleaseGroupAction(pendingDecision.input);
    setBusy(false);
    setPendingDecision(null);
    setMessage(result.message);
    if (result.ok) {
      resetEditor();
      router.refresh();
    }
  }

  return (
    <section className={styles.groupManager} aria-labelledby="release-groups-title">
      <header className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>作业小组</p>
          <h2 id="release-groups-title">共享提交分组</h2>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={busy}
          onClick={beginCreate}
          type="button"
        >
          新建作业小组
        </button>
      </header>
      <p className={styles.groupManagerLead}>
        同组成员使用一份草稿、附件、阶段提交与教师反馈。小组一旦开始保存，名称、成员和角色就会锁定。
      </p>

      {groups.length === 0 ? (
        <p className={styles.emptyState}>尚未建立作业小组；未分组学生继续个人提交。</p>
      ) : (
        <div className={styles.groupCardList}>
          {groups.map((entry) => (
            <article
              className={styles.groupCard}
              data-locked={entry.started ? "true" : "false"}
              key={entry.group.id}
            >
              <div>
                <h3>{entry.group.name}</h3>
                <p>
                  {entry.group.members
                    .map(
                      (member) =>
                        `${member.student.displayName}${
                          member.roleLabel ? `（${member.roleLabel}）` : ""
                        }`,
                    )
                    .join("、")}
                </p>
              </div>
              <span className={styles.statusBadge} data-tone={entry.started ? "sealed" : "ready"}>
                {entry.started ? "已有提交 · 已锁定" : "可编辑"}
              </span>
              {!entry.started ? (
                <div className={styles.groupCardActions}>
                  <button
                    className={styles.secondaryButton}
                    disabled={busy}
                    onClick={() => beginEdit(entry)}
                    type="button"
                  >
                    编辑 {entry.group.name}
                  </button>
                  <button
                    className={styles.dangerButton}
                    disabled={busy}
                    onClick={() =>
                      setPendingDecision({
                        kind: "DELETE",
                        groupName: entry.group.name,
                        input: {
                          releaseId,
                          groupId: entry.group.id,
                          idempotencyKey: `delete_release_group_${crypto.randomUUID()}`,
                        },
                      })
                    }
                    type="button"
                  >
                    删除 {entry.group.name}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {editorOpen ? (
        <div className={styles.groupEditor}>
          <header>
            <div>
              <p className={styles.eyebrow}>{editingGroupId ? "编辑分组" : "建立分组"}</p>
              <h3>{editingGroupId ? "更新作业小组" : "新建作业小组"}</h3>
            </div>
            <button className={styles.secondaryButton} disabled={busy} onClick={resetEditor} type="button">
              取消
            </button>
          </header>
          <label className={styles.groupNameField}>
            <span>小组名称</span>
            <input
              disabled={busy}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <fieldset className={styles.groupMemberFieldset}>
            <legend>选择成员并填写组内角色</legend>
            {availableStudents.length === 0 ? (
              <p>没有可加入小组的未分组学生。</p>
            ) : (
              availableStudents.map((student) => {
                const selected = selectedIds.includes(student.id);
                return (
                  <div data-unavailable={student.unavailable ? "true" : "false"} key={student.id}>
                    <label>
                      <input
                        checked={selected}
                        disabled={busy || student.unavailable}
                        onChange={() => toggleStudent(student.id)}
                        type="checkbox"
                      />
                      <span>{student.displayName}</span>
                    </label>
                    {student.unavailable ? (
                      <small>已有个人提交，不能再加入小组</small>
                    ) : selected ? (
                      <input
                        aria-label={`${student.displayName}的组内角色`}
                        disabled={busy}
                        maxLength={120}
                        onChange={(event) =>
                          setRoleLabels((current) => ({
                            ...current,
                            [student.id]: event.target.value,
                          }))
                        }
                        placeholder="组内角色（可留空）"
                        value={roleLabels[student.id] ?? ""}
                      />
                    ) : null}
                  </div>
                );
              })
            )}
          </fieldset>
          <button
            className={styles.primaryButton}
            disabled={busy || !name.trim() || selectedIds.length === 0}
            onClick={prepareSave}
            type="button"
          >
            {editingGroupId ? "准备更新小组" : "准备创建小组"}
          </button>
        </div>
      ) : null}

      {message ? <InlineAlert tone="info">{message}</InlineAlert> : null}

      <ConfirmDialog
        open={pendingDecision !== null}
        title={pendingDecision?.kind === "DELETE" ? "确认删除作业小组" : "确认共享提交分组"}
        detail={
          pendingDecision ? (
            <div className={styles.dialogDetail}>
              {pendingDecision.kind === "DELETE" ? (
                <>
                  <p>小组：{pendingDecision.groupName}</p>
                  <p>删除后成员恢复为未分组状态；已有提交的小组不会允许删除。</p>
                </>
              ) : (
                <>
                  <p>小组：{pendingDecision.input.name}</p>
                  <p>成员：{pendingDecision.memberSummary}</p>
                  <p>这些学生将共享同一份草稿、附件、正式修订和教师反馈。</p>
                </>
              )}
            </div>
          ) : null
        }
        confirmLabel={pendingDecision?.kind === "DELETE" ? "确认删除" : "确认分组"}
        tone={pendingDecision?.kind === "DELETE" ? "danger" : "primary"}
        pending={busy}
        disabled={busy}
        onCancel={() => setPendingDecision(null)}
        onConfirm={confirmDecision}
      />
    </section>
  );
}
