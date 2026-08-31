import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import { getTeacherProfile, TeacherProfileQueryError } from "../../../server/queries/teacher-profile";
import { listTeacherClassrooms, TeacherClassroomQueryError } from "../../../server/queries/teacher-classrooms";
import { TeacherAccessGate, TeacherPage, teacherHomeCrumb } from "../_components/teacher-shell";
import styles from "../teacher-identity.module.css";
import { ClassroomManager } from "./classroom-manager";

export default async function TeacherClassroomsPage() {
  let profile;
  let classrooms;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    [profile, classrooms] = await Promise.all([getTeacherProfile(database, context, {}), listTeacherClassrooms(database, context, {})]);
  } catch (error) {
    if (error instanceof AuthenticationError) return <TeacherAccessGate code={error.code} returnPath="/teacher/classrooms" />;
    if (error instanceof TeacherProfileQueryError || error instanceof TeacherClassroomQueryError) return <TeacherAccessGate code="UNAUTHENTICATED" returnPath="/teacher/classrooms" />;
    throw error;
  }
  return (
    <TeacherPage actorName={profile.displayName} breadcrumb={[teacherHomeCrumb, { label: "我的班级" }]}>
      <div className={styles.pageContent}><header className={styles.pageHeader}><h1>我的班级</h1></header><ClassroomManager classrooms={classrooms} /></div>
    </TeacherPage>
  );
}
