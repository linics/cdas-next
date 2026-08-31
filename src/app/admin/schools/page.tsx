import { connection } from "next/server";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import { listAdminSchools } from "../../../server/queries/admin-dashboard";
import { AdminAuthorizationError } from "../../../server/school/admin-authorization";
import { AdminAccessGate, AdminPage, adminHomeCrumb } from "../_components/admin-shell";
import styles from "../admin.module.css";
import { SchoolManager } from "./school-manager";

export default async function AdminSchoolsPage() {
  await connection();
  let schools;
  try {
    const context = await createUiCommandContext();
    schools = await listAdminSchools(getDatabaseClient(), context, {});
  } catch (error) {
    if (error instanceof AuthenticationError) return <AdminAccessGate code={error.code} />;
    if (error instanceof AdminAuthorizationError) return <AdminAccessGate code="FORBIDDEN" />;
    throw error;
  }
  return (
    <AdminPage actorName="平台管理员" breadcrumb={[adminHomeCrumb, { label: "学校管理" }]}>
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}><div><h1>学校管理</h1></div></header>
        <div className={styles.body}><SchoolManager schools={schools} /></div>
      </div>
    </AdminPage>
  );
}
