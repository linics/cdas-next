"use client";

import { useActionState, useState } from "react";
import { disciplineCatalog } from "../../../domain/activity/activity-content";
import { InlineAlert } from "../../_components/ui";
import { initialTeacherIdentityActionState } from "../identity-action-state";
import {
  registerTeacherAction,
  verifyTeacherInviteAction,
} from "../identity-actions";
import styles from "../teacher-identity.module.css";

export function TeacherRegistrationForm() {
  const [schoolCode, setSchoolCode] = useState("");
  const [teacherInviteCode, setTeacherInviteCode] = useState("");
  const [secondary, setSecondary] = useState<string[]>([]);
  const [verifyState, verifyAction, verifying] = useActionState(verifyTeacherInviteAction, initialTeacherIdentityActionState);
  const [registrationState, registerAction, registering] = useActionState(registerTeacherAction, initialTeacherIdentityActionState);
  const verified = verifyState.status === "verified" && verifyState.schoolName && verifyState.schoolCode;
  const state = registrationState.status === "idle" ? verifyState : registrationState;
  return (
    <div className={styles.pageContent}>
      <header className={styles.pageHeader}><h1>开通教师账号</h1><p>使用学校邀请码开通账号。</p></header>
      <section className={styles.panel}>
        <header className={styles.panelHeader}><h2>验证学校邀请码</h2></header>
        <form action={verifyAction} className={styles.form}>
          <div className={styles.twoColumn}>
            <div className={styles.field}><label htmlFor="register-school-code">学校代码</label><input autoCapitalize="characters" id="register-school-code" maxLength={16} name="schoolCode" onChange={(event) => setSchoolCode(event.target.value)} required value={schoolCode} /></div>
            <div className={styles.field}><label htmlFor="register-invite">教师邀请码</label><input id="register-invite" name="teacherInviteCode" onChange={(event) => setTeacherInviteCode(event.target.value)} required value={teacherInviteCode} /></div>
          </div>
          <button className={styles.primaryButton} disabled={verifying} type="submit">{verifying ? "正在验证…" : "验证邀请码"}</button>
        </form>
        {verifyState.status !== "idle" ? <div className={styles.result}><InlineAlert tone={verified ? "success" : verifyState.status === "validation_error" ? "warning" : "danger"}>{verifyState.message}</InlineAlert></div> : null}
      </section>
      {verified ? (
        <section className={styles.panel}>
          <header className={styles.panelHeader}><h2>填写教师资料</h2></header>
          <div className={styles.summary}><span>已验证学校</span><strong>{verifyState.schoolName}</strong><span>学校代码：{verifyState.schoolCode}</span></div>
          <form action={registerAction} className={styles.form}>
            <input name="schoolCode" type="hidden" value={schoolCode} /><input name="teacherInviteCode" type="hidden" value={teacherInviteCode} /><input name="secondaryDisciplineCodes" type="hidden" value={secondary.join(",")} />
            <div className={styles.twoColumn}>
              <div className={styles.field}><label htmlFor="register-staff-no">工号</label><input autoCapitalize="characters" id="register-staff-no" maxLength={32} name="staffNo" required /></div>
              <div className={styles.field}><label htmlFor="register-name">姓名</label><input autoComplete="name" id="register-name" maxLength={120} name="displayName" required /></div>
            </div>
            <div className={styles.twoColumn}>
              <div className={styles.field}><label htmlFor="register-primary">主教学科</label><select id="register-primary" name="primaryDisciplineCode" required defaultValue=""><option disabled value="">请选择</option>{disciplineCatalog.map((discipline) => <option key={discipline.code} value={discipline.code}>{discipline.label}</option>)}</select></div>
              <div className={styles.field}><label htmlFor="register-secondary">兼教学科（可多选）</label><select id="register-secondary" multiple onChange={(event) => setSecondary(Array.from(event.target.selectedOptions, (option) => option.value))}>{disciplineCatalog.map((discipline) => <option key={discipline.code} value={discipline.code}>{discipline.label}</option>)}</select></div>
            </div>
            <div className={styles.field}><label htmlFor="register-password">设置密码</label><input autoComplete="new-password" id="register-password" minLength={10} name="password" required type="password" /></div>
            <button className={styles.primaryButton} disabled={registering} type="submit">{registering ? "正在开通…" : "开通教师账号"}</button>
          </form>
          {registrationState.status !== "idle" ? <div className={styles.result}><InlineAlert tone={registrationState.status === "success" ? "success" : registrationState.status === "validation_error" ? "warning" : "danger"}>{registrationState.message}</InlineAlert>{registrationState.status === "success" ? <p className={styles.note}><a href="/teacher/login">前往教师登录</a></p> : null}</div> : null}
        </section>
      ) : null}
      {state.status === "success" ? null : <p className={styles.note}>已有账号？<a href="/teacher/login">进入教师登录</a></p>}
    </div>
  );
}
