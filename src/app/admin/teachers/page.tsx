import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import {
  AdminDashboardQueryError,
  getAdminDashboard,
  listAdminSchools,
  listAdminTeachers,
} from "../../../server/queries/admin-dashboard";
import {
  AdminAccessGate,
  AdminPage,
  adminHomeCrumb,
} from "../_components/admin-shell";
import styles from "../admin.module.css";
import { TeacherManager } from "./teacher-manager";

export default async function AdminTeachersPage() {
  let dashboard;
  let schools;
  let teachers;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    [dashboard, schools, teachers] = await Promise.all([
      getAdminDashboard(database, context, {}),
      listAdminSchools(database, context, {}),
      listAdminTeachers(database, context, {}),
    ]);
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
    <AdminPage
      actorName={dashboard.actor.displayName}
      breadcrumb={[adminHomeCrumb, { label: "教师" }]}
    >
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>教师</p>
          <h1>按学校登记与启停</h1>
          <p>新教师只写入业务身份，保持待开通。同校工号唯一，跨校可以重复。</p>
        </div>
      </header>
      <TeacherManager
        schools={schools.schools.map((school) => ({
          id: school.id,
          name: school.name,
          code: school.code,
        }))}
        teachers={teachers.teachers}
      />
    </AdminPage>
  );
}
