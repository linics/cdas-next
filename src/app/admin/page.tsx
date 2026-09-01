import { AuthenticationError } from "../../server/auth/current-actor";
import { createUiCommandContext } from "../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../server/db/client";
import {
  AdminDashboardQueryError,
  getAdminDashboard,
} from "../../server/queries/admin-dashboard";
import {
  AdminAccessGate,
  AdminPage,
} from "./_components/admin-shell";
import styles from "./admin.module.css";

export default async function AdminHomePage() {
  let dashboard;
  try {
    dashboard = await getAdminDashboard(
      getDatabaseClient(),
      await createUiCommandContext(),
      {},
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <AdminAccessGate code={error.code} />;
    }
    if (error instanceof AdminDashboardQueryError) {
      return <AdminAccessGate code="USER_NOT_PROVISIONED" />;
    }
    throw error;
  }

  return (
    <AdminPage actorName={dashboard.actor.displayName}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>管理员</p>
          <h1>学校与教师边界</h1>
          <p>这里只统计学校、教师、学生和班级数量，不打开活动、提交或评价。</p>
        </div>
      </header>
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>学校</dt>
          <dd>{dashboard.schoolCount}</dd>
        </div>
        <div className={styles.stat}>
          <dt>教师</dt>
          <dd>{dashboard.teacherCount}</dd>
        </div>
        <div className={styles.stat}>
          <dt>学生</dt>
          <dd>{dashboard.studentCount}</dd>
        </div>
        <div className={styles.stat}>
          <dt>班级</dt>
          <dd>{dashboard.classroomCount}</dd>
        </div>
      </dl>
    </AdminPage>
  );
}
