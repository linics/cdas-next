import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  getTeacherIdentity,
  TeacherActivityQueryError,
} from "../../../../server/queries/teacher-activity-workspace";
import { TeacherAccessGate, TeacherPage, teacherHomeCrumb } from "../../_components/teacher-shell";
import styles from "../../teacher-workspace.module.css";
import { ClassroomForm } from "./classroom-form";

export default async function NewClassroomPage() {
  let actor;
  try {
    actor = await getTeacherIdentity(
      getDatabaseClient(),
      await createUiCommandContext(),
      {},
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <TeacherAccessGate code={error.code} returnPath="/teacher/classrooms/new" />;
    }
    if (error instanceof TeacherActivityQueryError || error instanceof ZodError) notFound();
    throw error;
  }

  return (
    <TeacherPage
      actorName={actor.displayName}
      breadcrumb={[teacherHomeCrumb, { label: "新建班级" }]}
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>教师工作台 / 班级</p>
            <h1>新建班级</h1>
            <p>班级属于你所在的学校，由你负责管理；创建后即可导入学生或用名单码加入成员。</p>
          </div>
          <Link className={styles.rowLink} href="/teacher">返回教师工作台</Link>
        </header>
        <ClassroomForm />
      </div>
    </TeacherPage>
  );
}
