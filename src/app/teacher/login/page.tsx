import Link from "next/link";
import { LocalLoginForm } from "../../auth/local-login-form";
import styles from "../../_components/access-gate.module.css";

export default function TeacherLoginPage() {
  return (
    <main className={styles.accessGate}>
      <p className={styles.eyebrow}>教师登录</p>
      <h1>进入教师工作台</h1>
      <LocalLoginForm role="TEACHER">
        <Link className={styles.backLink} href="/teacher/register">使用邀请码开通</Link>
      </LocalLoginForm>
    </main>
  );
}
