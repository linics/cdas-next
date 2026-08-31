"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, type ReactNode } from "react";
import { InlineAlert } from "../_components/ui";
import { type LocalLoginState, initialLocalLoginState } from "./local-login-state";
import styles from "../teacher/teacher-identity.module.css";

type LoginField = Readonly<{ name: string; label: string; autoComplete?: string; autoCapitalize?: "none" | "characters"; inputMode?: "numeric"; maxLength?: number }>;

export function LocalLoginForm({ title, detail, fields, action, footer, variant = "default" }: { title: string; detail?: string; fields: readonly LoginField[]; action: (previous: LocalLoginState, formData: FormData) => Promise<LocalLoginState>; footer?: ReactNode; variant?: "default" | "teacher" }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialLocalLoginState);
  useEffect(() => { if (state.status === "success" && state.destination) router.replace(state.destination); }, [router, state.destination, state.status]);
  const teacherSplit = variant === "teacher";
  return <main className={`${styles.loginShell} ${teacherSplit ? styles.teacherLoginShell : ""}`} data-login-layout={teacherSplit ? "teacher-split" : undefined}>
    {teacherSplit ? <aside className={styles.loginVisual} aria-label="CDAS 跨学科学习场景">
      <Image alt="跨学科学习场景插图" className={styles.loginVisualImage} fill preload sizes="(max-width: 860px) 100vw, 50vw" src="/images/cdas-learning-login-hero-v1.png" />
      <div className={styles.loginVisualCopy}><strong>CDAS</strong><span>跨学科学习活动</span><p>设计任务、连接学科、看见每一份学习证据。</p></div>
    </aside> : null}
    <section className={`${styles.loginPanel} ${teacherSplit ? styles.teacherLoginPanel : ""}`}>
      {teacherSplit ? <p className={styles.loginEyebrow}>教师工作台</p> : null}
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
      <form action={formAction} className={styles.form}>{fields.map((field) => <div className={styles.field} key={field.name}><label htmlFor={`login-${field.name}`}>{field.label}</label><input autoCapitalize={field.autoCapitalize} autoComplete={field.autoComplete} id={`login-${field.name}`} inputMode={field.inputMode} maxLength={field.maxLength} name={field.name} required type={field.name === "password" ? "password" : "text"} /></div>)}<button className={styles.primaryButton} disabled={pending} type="submit">{pending ? "正在登录…" : "登录"}</button></form>
      {state.status === "error" ? <div className={styles.result}><InlineAlert tone="warning">{state.message}</InlineAlert></div> : null}
      <div className={styles.loginLinks}>{footer}<Link href="/">返回首页</Link></div>
    </section>
  </main>;
}
