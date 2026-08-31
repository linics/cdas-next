"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, type ReactNode } from "react";
import { InlineAlert } from "../_components/ui";
import { type LocalLoginState, initialLocalLoginState } from "./local-login-state";
import styles from "../teacher/teacher-identity.module.css";

type LoginField = Readonly<{ name: string; label: string; autoComplete?: string; autoCapitalize?: "none" | "characters"; inputMode?: "numeric"; maxLength?: number }>;

export function LocalLoginForm({ title, detail, fields, action, footer }: { title: string; detail?: string; fields: readonly LoginField[]; action: (previous: LocalLoginState, formData: FormData) => Promise<LocalLoginState>; footer?: ReactNode }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialLocalLoginState);
  useEffect(() => { if (state.status === "success" && state.destination) router.replace(state.destination); }, [router, state.destination, state.status]);
  return <main className={styles.loginShell}><section className={styles.loginPanel}><h1>{title}</h1>{detail ? <p>{detail}</p> : null}<form action={formAction} className={styles.form}>{fields.map((field) => <div className={styles.field} key={field.name}><label htmlFor={`login-${field.name}`}>{field.label}</label><input autoCapitalize={field.autoCapitalize} autoComplete={field.autoComplete} id={`login-${field.name}`} inputMode={field.inputMode} maxLength={field.maxLength} name={field.name} required type={field.name === "password" ? "password" : "text"} /></div>)}<button className={styles.primaryButton} disabled={pending} type="submit">{pending ? "正在登录…" : "登录"}</button></form>{state.status === "error" ? <div className={styles.result}><InlineAlert tone="warning">{state.message}</InlineAlert></div> : null}<div className={styles.loginLinks}>{footer}<Link href="/">返回首页</Link></div></section></main>;
}
