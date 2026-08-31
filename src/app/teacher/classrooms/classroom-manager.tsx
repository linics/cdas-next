"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { TeacherClassroom } from "../../../server/queries/teacher-classrooms";
import { InlineAlert } from "../../_components/ui";
import { initialTeacherWorkspaceActionState } from "../identity-action-state";
import {
  createClassroomAction,
} from "../identity-actions";
import styles from "../teacher-identity.module.css";

export function ClassroomManager({ classrooms }: { classrooms: readonly TeacherClassroom[] }) {
  const formId = useId().replace(/:/gu, "");
  const [attempt, setAttempt] = useState(0);
  const [state, action, pending] = useActionState(createClassroomAction, initialTeacherWorkspaceActionState);
  const handled = useRef<typeof state | null>(null);
  useEffect(() => {
    if (state.status === "success" && handled.current !== state) {
      handled.current = state;
      setAttempt((value) => value + 1);
    }
  }, [state]);
  return (
    <>
      <section className={styles.panel}>
        <header className={styles.panelHeader}><h2>创建班级</h2></header>
        <form action={action} className={styles.form}><input name="idempotencyKey" type="hidden" value={`create_classroom_${formId}_${attempt}`} /><div className={styles.field}><label htmlFor="classroom-name">班级名称</label><input id="classroom-name" maxLength={120} name="name" placeholder="例如：七年一班" required /></div><button className={styles.primaryButton} disabled={pending} type="submit">{pending ? "正在创建…" : "创建班级"}</button></form>
        {state.status !== "idle" ? <div className={styles.result}><InlineAlert tone={state.status === "success" ? "success" : state.status === "validation_error" ? "warning" : "danger"}>{state.message}</InlineAlert></div> : null}
      </section>
      <section className={styles.panel}>
        <header className={styles.panelHeader}><h2>班级列表</h2></header>
        <div className={styles.classroomList}>{classrooms.length === 0 ? <p className={styles.note}>尚未创建班级。</p> : classrooms.map((classroom) => <Link className={styles.classroomRow} href={`/teacher/classrooms/${classroom.id}/members`} key={classroom.id}><strong>{classroom.name}</strong><span>{classroom.currentMemberCount} 名当前成员 · 版本 {classroom.version}</span></Link>)}</div>
      </section>
    </>
  );
}
