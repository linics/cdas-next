"use client";

import { useActionState, useState } from "react";
import { ConfirmDialog, InlineAlert, StatusBadge } from "../../_components/ui";
import {
  teacherManagerAction,
} from "../actions";
import { idleAdminActionState } from "../action-state";
import styles from "../admin.module.css";

type SchoolOption = { id: string; name: string; code: string };
type TeacherRow = {
  id: string;
  displayName: string;
  staffNo: string | null;
  accountStatus: "ACTIVE" | "DISABLED";
  legacyProfile: boolean;
  provisioningStatus: "PENDING" | "COMPLETED" | "FAILED" | null;
  school: SchoolOption;
};

export function TeacherManager({
  schools,
  teachers,
}: {
  schools: readonly SchoolOption[];
  teachers: readonly TeacherRow[];
}) {
  const [actionState, dispatchAction, actionPending] = useActionState(
    teacherManagerAction,
    idleAdminActionState,
  );
  const [pendingTeacher, setPendingTeacher] = useState<TeacherRow | null>(null);
  return (
    <div className={styles.stack}>
      {actionState.message ? (
        <InlineAlert tone={actionState.status === "error" ? "danger" : "success"}>
          {actionState.message}
        </InlineAlert>
      ) : null}

      <form action={dispatchAction} className={styles.form}>
        <input name="operation" type="hidden" value="register" />
        <h2>登记本校教师</h2>
        <p>只创建业务身份，停在待开通。不调用认证供应商，也不能立刻登录。</p>
        <div className={styles.field}>
          <label htmlFor="teacher-school">学校</label>
          <select id="teacher-school" name="schoolId" required>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}（{school.code}）
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="teacher-name">姓名</label>
          <input id="teacher-name" maxLength={120} name="displayName" required />
        </div>
        <div className={styles.field}>
          <label htmlFor="teacher-staff">工号</label>
          <input id="teacher-staff" maxLength={32} name="staffNo" required />
        </div>
        <button className={styles.primaryButton} disabled={actionPending} type="submit">
          登记教师
        </button>
      </form>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>姓名</th>
            <th>学校</th>
            <th>工号</th>
            <th>开通</th>
            <th>账号</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {teachers.map((teacher) => (
            <tr key={teacher.id}>
              <td>{teacher.displayName}</td>
              <td>
                {teacher.school.name}（{teacher.school.code}）
              </td>
              <td>{teacher.staffNo ?? (teacher.legacyProfile ? "历史账号" : "—")}</td>
              <td>
                {teacher.provisioningStatus === "PENDING"
                  ? "待开通"
                  : teacher.legacyProfile
                    ? "历史迁移"
                    : teacher.provisioningStatus ?? "—"}
              </td>
              <td>
                <StatusBadge
                  tone={teacher.accountStatus === "ACTIVE" ? "info" : "neutral"}
                >
                  {teacher.accountStatus === "ACTIVE" ? "启用" : "停用"}
                </StatusBadge>
              </td>
              <td>
                <button
                  className={styles.dangerButton}
                  onClick={() => setPendingTeacher(teacher)}
                  type="button"
                >
                  {teacher.accountStatus === "ACTIVE" ? "停用" : "恢复"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmDialog
        open={Boolean(pendingTeacher)}
        title={
          pendingTeacher?.accountStatus === "ACTIVE"
            ? "停用这位教师？"
            : "恢复这位教师？"
        }
        detail="停用后该教师不能再进入教学工作台。已发布活动与评价历史保持原样。"
        confirmLabel={
          pendingTeacher?.accountStatus === "ACTIVE" ? "确认停用" : "确认恢复"
        }
        tone={pendingTeacher?.accountStatus === "ACTIVE" ? "danger" : "primary"}
        pending={actionPending}
        onCancel={() => setPendingTeacher(null)}
        onConfirm={() => {
          if (!pendingTeacher) return;
          const data = new FormData();
          data.set("operation", "status");
          data.set("teacherId", pendingTeacher.id);
          data.set(
            "accountStatus",
            pendingTeacher.accountStatus === "ACTIVE" ? "DISABLED" : "ACTIVE",
          );
          dispatchAction(data);
          setPendingTeacher(null);
        }}
      />
    </div>
  );
}
