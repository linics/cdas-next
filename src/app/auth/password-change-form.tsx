"use client";

import { useActionState } from "react";
import {
  changeStudentPasswordAction,
  changeTeacherPasswordAction,
  type PasswordActionState,
} from "./password-change-actions";
import Link from "next/link";
import gateStyles from "../_components/access-gate.module.css";
import formStyles from "./local-login-form.module.css";

export function PasswordChangeForm({ role, actorName }: { role: "teacher" | "student"; actorName: string }) {
  const action = role === "teacher"
    ? changeTeacherPasswordAction
    : changeStudentPasswordAction;
  const [state, formAction, pending] = useActionState<PasswordActionState, FormData>(
    action,
    {},
  );
  return (
    <div className={gateStyles.gate}>
      <section className={gateStyles.gateAside}>
        <Link className={gateStyles.brand} href="/" aria-label="返回 CDAS Next 首页">
          <strong>CDAS</strong>
          <small>跨学科学习活动</small>
        </Link>
        <div className={gateStyles.pitch}>
          <p className={gateStyles.eyebrow}>{role === "teacher" ? "教师" : "学生"} · 首次登录</p>
          <h1>先设置一份只属于你的新密码</h1>
          <p>完成设置后，即可进入你的工作台。这个初始密码不会继续保留。</p>
        </div>
        <ol className={gateStyles.steps}>
          <li><span>01</span>设置新密码</li>
          <li><span>02</span>进入工作台</li>
        </ol>
      </section>
      <main className={gateStyles.accessGate}>
        <div>
          <p className={gateStyles.eyebrow}>当前账号 · {actorName}</p>
          <h2>请先设置新密码</h2>
        </div>
        <form action={formAction} className={formStyles.form}>
          <label className={formStyles.field} htmlFor="new-password">
            <span>新密码</span>
            <input id="new-password" name="password" type="password" autoComplete="new-password" required />
          </label>
          <label className={formStyles.field} htmlFor="password-confirmation">
            <span>确认密码</span>
            <input id="password-confirmation" name="confirmation" type="password" autoComplete="new-password" required />
          </label>
          {state.error ? <p className={formStyles.error} role="alert">{state.error}</p> : null}
          <button className={formStyles.submit} disabled={pending} type="submit">
            {pending ? "正在保存…" : "保存新密码"}
            <span aria-hidden="true">→</span>
          </button>
        </form>
      </main>
    </div>
  );
}
