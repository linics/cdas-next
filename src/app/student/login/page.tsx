import Link from "next/link";
import { LocalLoginForm } from "../../auth/local-login-form";
import styles from "../../_components/access-gate.module.css";

export default function StudentLoginPage() {
  return (
    <main className={styles.accessGate}>
      <p className={styles.eyebrow}>学生登录</p>
      <h1>进入学生工作台</h1>
      <LocalLoginForm role="STUDENT">
        <Link className={styles.backLink} href="/">返回首页</Link>
      </LocalLoginForm>
    </main>
  );
}
