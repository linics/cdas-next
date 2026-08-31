"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { disciplineCatalog } from "../../../domain/activity/activity-content";
import type { TeacherProfile } from "../../../server/queries/teacher-profile";
import { InlineAlert } from "../../_components/ui";
import { initialTeacherWorkspaceActionState } from "../identity-action-state";
import {
  updateTeacherProfileAction,
} from "../identity-actions";
import styles from "../teacher-identity.module.css";

export function TeacherProfileForm({ profile }: { profile: TeacherProfile }) {
  const baseId = useId().replace(/:/gu, "");
  const [attempt, setAttempt] = useState(0);
  const [secondary, setSecondary] = useState(profile.secondaryDisciplineCodes);
  const [state, action, pending] = useActionState(updateTeacherProfileAction, initialTeacherWorkspaceActionState);
  const handled = useRef<typeof state | null>(null);
  useEffect(() => {
    if (state.status === "success" && handled.current !== state) {
      handled.current = state;
      setAttempt((value) => value + 1);
    }
  }, [state]);
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeader}><h2>任教信息</h2></header>
      <div className={styles.summary}><span>{profile.school.name} · {profile.school.code}</span><strong>工号：{profile.staffNo}</strong></div>
      <form action={action} className={styles.form}>
        <input name="idempotencyKey" type="hidden" value={`update_teacher_profile_${baseId}_${attempt}`} /><input name="secondaryDisciplineCodes" type="hidden" value={secondary.join(",")} />
        <div className={styles.field}><label htmlFor="profile-name">姓名</label><input defaultValue={profile.displayName} id="profile-name" maxLength={120} name="displayName" required /></div>
        <div className={styles.twoColumn}>
          <div className={styles.field}><label htmlFor="profile-primary">主教学科</label><select defaultValue={profile.primaryDisciplineCode} id="profile-primary" name="primaryDisciplineCode">{disciplineCatalog.map((discipline) => <option key={discipline.code} value={discipline.code}>{discipline.label}</option>)}</select></div>
          <div className={styles.field}><label htmlFor="profile-secondary">兼教学科（可多选）</label><select defaultValue={profile.secondaryDisciplineCodes} id="profile-secondary" multiple onChange={(event) => setSecondary(Array.from(event.target.selectedOptions, (option) => option.value))}>{disciplineCatalog.map((discipline) => <option key={discipline.code} value={discipline.code}>{discipline.label}</option>)}</select></div>
        </div>
        <button className={styles.primaryButton} disabled={pending} type="submit">{pending ? "正在保存…" : "保存资料"}</button>
      </form>
      {state.status !== "idle" ? <div className={styles.result}><InlineAlert tone={state.status === "success" ? "success" : state.status === "validation_error" ? "warning" : "danger"}>{state.message}</InlineAlert></div> : null}
    </section>
  );
}
