import Link from "next/link";
import { connection } from "next/server";
import { AuthenticationError } from "../../server/auth/current-actor";
import { createUiCommandContext } from "../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../server/db/client";
import { getAdminDashboard } from "../../server/queries/admin-dashboard";
import { AdminAuthorizationError } from "../../server/school/admin-authorization";
import { AdminAccessGate, AdminPage } from "./_components/admin-shell";
import styles from "./admin.module.css";

export default async function AdminDashboardPage() {
  await connection();
  let dashboard;
  try {
    const context = await createUiCommandContext();
    dashboard = await getAdminDashboard(getDatabaseClient(), context, {});
  } catch (error) {
    if (error instanceof AuthenticationError) return <AdminAccessGate code={error.code} />;
    if (error instanceof AdminAuthorizationError) return <AdminAccessGate code="FORBIDDEN" />;
    throw error;
  }
  return (
    <AdminPage actorName="平台管理员" breadcrumb={[{ label: "管理员工作台" }]}>
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <h1>学校与教师管理</h1>
          </div>
        </header>
        <div className={styles.body}>
          <section className={styles.statGrid} aria-label="平台汇总">
            <article className={styles.statCard}><span>学校</span><strong>{dashboard.schoolCount}</strong></article>
            <article className={styles.statCard}><span>教师</span><strong>{dashboard.teacherCount}</strong></article>
            <article className={styles.statCard}><span>学生</span><strong>{dashboard.studentCount}</strong></article>
            <article className={styles.statCard}><span>班级</span><strong>{dashboard.classroomCount}</strong></article>
          </section>
          <section className={styles.section}>
            <header className={styles.sectionHeader}><h2>管理入口</h2></header>
            <div className={styles.linkGrid}>
              <Link className={styles.actionLink} href="/admin/schools"><strong>学校管理</strong><span>建校、修改名称、启停学校与重置教师邀请码。</span></Link>
              <Link className={styles.actionLink} href="/admin/teachers"><strong>教师管理</strong><span>查看教师资料、启停账号与一次性密码重置。</span></Link>
            </div>
          </section>
        </div>
      </div>
    </AdminPage>
  );
}
