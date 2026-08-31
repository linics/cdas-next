import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import {
  AdminDashboardQueryError,
  getAdminDashboard,
  listAdminSchools,
} from "../../../server/queries/admin-dashboard";
import {
  AdminAccessGate,
  AdminPage,
  adminHomeCrumb,
} from "../_components/admin-shell";
import styles from "../admin.module.css";
import { SchoolManager } from "./school-manager";

export default async function AdminSchoolsPage() {
  let dashboard;
  let listing;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    [dashboard, listing] = await Promise.all([
      getAdminDashboard(database, context, {}),
      listAdminSchools(database, context, {}),
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
      breadcrumb={[adminHomeCrumb, { label: "学校" }]}
    >
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>学校</p>
          <h1>建校、启停与邀请码</h1>
          <p>学校代码创建后不可改。邀请码明文只在创建或重置时出现一次。</p>
        </div>
      </header>
      <SchoolManager schools={listing.schools} />
    </AdminPage>
  );
}
