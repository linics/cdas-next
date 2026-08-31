"use client";

import { useActionState, useState } from "react";
import { ConfirmDialog, InlineAlert, StatusBadge } from "../../_components/ui";
import {
  schoolManagerAction,
} from "../actions";
import { idleAdminActionState } from "../action-state";
import styles from "../admin.module.css";

type SchoolRow = {
  id: string;
  name: string;
  code: string;
  status: "ACTIVE" | "DISABLED";
  teacherCount: number;
  studentCount: number;
  classroomCount: number;
};

export function SchoolManager({ schools }: { schools: readonly SchoolRow[] }) {
  const [actionState, dispatchAction, actionPending] = useActionState(
    schoolManagerAction,
    idleAdminActionState,
  );
  const [pendingSchool, setPendingSchool] = useState<SchoolRow | null>(null);
  const [pendingInvite, setPendingInvite] = useState<SchoolRow | null>(null);

  return (
    <div className={styles.stack}>
      {actionState.message ? (
        <InlineAlert tone={actionState.status === "error" ? "danger" : "success"}>
          {actionState.message}
        </InlineAlert>
      ) : null}
      {actionState.inviteCode ? (
        <p className={styles.invite}>
          教师邀请码（只显示一次）：{actionState.inviteCode}
        </p>
      ) : null}

      <form action={dispatchAction} className={styles.form}>
        <input name="operation" type="hidden" value="create" />
        <h2>新建学校</h2>
        <div className={styles.field}>
          <label htmlFor="school-name">学校名称</label>
          <input id="school-name" maxLength={120} name="name" required />
        </div>
        <button className={styles.primaryButton} disabled={actionPending} type="submit">
          创建学校
        </button>
      </form>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>名称</th>
            <th>代码</th>
            <th>状态</th>
            <th>教师</th>
            <th>学生</th>
            <th>班级</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {schools.map((school) => (
            <tr key={school.id}>
              <td>
                <form action={dispatchAction} className={styles.actions}>
                  <input name="operation" type="hidden" value="rename" />
                  <input name="schoolId" type="hidden" value={school.id} />
                  <input
                    aria-label={`${school.code} 学校名称`}
                    defaultValue={school.name}
                    maxLength={120}
                    name="name"
                    required
                  />
                  <button
                    className={styles.secondaryButton}
                    disabled={actionPending}
                    type="submit"
                  >
                    保存名称
                  </button>
                </form>
              </td>
              <td>{school.code}</td>
              <td>
                <StatusBadge tone={school.status === "ACTIVE" ? "info" : "neutral"}>
                  {school.status === "ACTIVE" ? "启用" : "停用"}
                </StatusBadge>
              </td>
              <td>{school.teacherCount}</td>
              <td>{school.studentCount}</td>
              <td>{school.classroomCount}</td>
              <td>
                <div className={styles.actions}>
                  <button
                    className={styles.dangerButton}
                    onClick={() => setPendingSchool(school)}
                    type="button"
                  >
                    {school.status === "ACTIVE" ? "停用" : "恢复"}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => setPendingInvite(school)}
                    type="button"
                  >
                    重置邀请码
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmDialog
        open={Boolean(pendingSchool)}
        title={pendingSchool?.status === "ACTIVE" ? "停用这所学校？" : "恢复这所学校？"}
        detail="停用后该校教师与学生不能再进入业务工作台。已有活动、提交和评价保持原样。"
        confirmLabel={pendingSchool?.status === "ACTIVE" ? "确认停用" : "确认恢复"}
        tone={pendingSchool?.status === "ACTIVE" ? "danger" : "primary"}
        pending={actionPending}
        onCancel={() => setPendingSchool(null)}
        onConfirm={() => {
          if (!pendingSchool) return;
          const data = new FormData();
          data.set("operation", "status");
          data.set("schoolId", pendingSchool.id);
          data.set(
            "status",
            pendingSchool.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
          );
          dispatchAction(data);
          setPendingSchool(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingInvite)}
        title="重置教师邀请码？"
        detail="旧邀请码立即失效。新明文只出现在本次结果里，不会写入数据库或审计。"
        confirmLabel="确认重置"
        tone="danger"
        pending={actionPending}
        onCancel={() => setPendingInvite(null)}
        onConfirm={() => {
          if (!pendingInvite) return;
          const data = new FormData();
          data.set("operation", "reset-invite");
          data.set("schoolId", pendingInvite.id);
          dispatchAction(data);
          setPendingInvite(null);
        }}
      />
    </div>
  );
}
