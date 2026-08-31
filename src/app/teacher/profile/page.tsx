import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import { getTeacherProfile, TeacherProfileQueryError } from "../../../server/queries/teacher-profile";
import { TeacherAccessGate, TeacherPage, teacherHomeCrumb } from "../_components/teacher-shell";
import styles from "../teacher-identity.module.css";
import { TeacherProfileForm } from "./teacher-profile-form";

export default async function TeacherProfilePage() {
  let profile;
  try {
    const context = await createUiCommandContext();
    profile = await getTeacherProfile(getDatabaseClient(), context, {});
  } catch (error) {
    if (error instanceof AuthenticationError) return <TeacherAccessGate code={error.code} returnPath="/teacher/profile" />;
    if (error instanceof TeacherProfileQueryError) return <TeacherAccessGate code="UNAUTHENTICATED" returnPath="/teacher/profile" />;
    throw error;
  }
  return (
    <TeacherPage actorName={profile.displayName} breadcrumb={[teacherHomeCrumb, { label: "我的资料" }]}>
      <div className={styles.pageContent}><header className={styles.pageHeader}><h1>我的资料</h1></header><TeacherProfileForm profile={profile} /></div>
    </TeacherPage>
  );
}
