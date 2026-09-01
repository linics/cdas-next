"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  registerTeacherAction,
  type RegisterTeacherActionState,
} from "./actions";
import gateStyles from "../../_components/access-gate.module.css";
import formStyles from "../../auth/local-login-form.module.css";

// A "use server" module may only export async functions, so the idle state
// lives with the form that owns it.
const idleState: RegisterTeacherActionState = {
  schoolCode: "",
  staffNo: "",
  displayName: "",
};

export default function TeacherRegisterPage() {
  const [state, formAction, pending] = useActionState(
    registerTeacherAction,
    idleState,
  );
  return (
    <div className={gateStyles.gate}>
      <section className={gateStyles.gateAside}>
        <Link className={gateStyles.brand} href="/" aria-label="返回 CDAS Next 首页">
          <strong>CDAS</strong>
          <small>跨学科学习活动</small>
        </Link>
        <div className={gateStyles.pitch}>
          <p className={gateStyles.eyebrow}>教师账号开通</p>
          <h1>用邀请码建立你的教师工作台</h1>
          <p>填写学校提供的邀请码与身份信息。开通完成后，可以直接进入活动设计与班级管理。</p>
        </div>
        <ol className={gateStyles.steps}>
          <li><span>01</span>确认学校</li>
          <li><span>02</span>验证邀请</li>
          <li><span>03</span>开始设计</li>
        </ol>
      </section>
      <main className={gateStyles.accessGate}>
        <div>
          <p className={gateStyles.eyebrow}>教师账号开通</p>
          <h2>使用学校邀请码开通</h2>
        </div>
        <form action={formAction} className={formStyles.form}>
          <label className={formStyles.field} htmlFor="register-school">
            <span>学校代码</span>
            <input id="register-school" name="schoolCode" autoComplete="organization" defaultValue={state.schoolCode} required />
          </label>
          <label className={formStyles.field} htmlFor="register-invite">
            <span>学校邀请码</span>
            <input id="register-invite" name="inviteCode" autoComplete="one-time-code" required />
          </label>
          <label className={formStyles.field} htmlFor="register-staff">
            <span>工号</span>
            <input id="register-staff" name="staffNo" autoComplete="username" defaultValue={state.staffNo} required />
          </label>
          <label className={formStyles.field} htmlFor="register-name">
            <span>显示名称</span>
            <input id="register-name" name="displayName" defaultValue={state.displayName} required />
          </label>
          <label className={formStyles.field} htmlFor="register-password">
            <span>密码</span>
            <input id="register-password" name="password" type="password" autoComplete="new-password" required />
          </label>
          {state.error ? <p className={formStyles.error} role="alert">{state.error}</p> : null}
          <button className={formStyles.submit} disabled={pending} type="submit">
            {pending ? "正在开通…" : "开通账号"}
            <span aria-hidden="true">→</span>
          </button>
          <Link className={gateStyles.backLink} href="/teacher">返回教师工作台</Link>
        </form>
      </main>
    </div>
  );
}
