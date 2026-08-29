import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AuthenticationError } from "../../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../../server/db/client";
import {
  getTeacherClassroomRoster,
  TeacherClassroomRosterQueryError,
} from "../../../../../server/queries/teacher-classroom-roster";
import { TeacherAccessGate, TeacherPage, teacherHomeCrumb } from "../../../_components/teacher-shell";
import styles from "../../../teacher-workspace.module.css";
import { RosterManager } from "./roster-manager";

export default async function TeacherClassroomMembersPage({
  params,
}: {
  params: Promise<{ classroomId: string }>;
}) {
  const { classroomId } = await params;
  let roster;
  try {
    roster = await getTeacherClassroomRoster(
      getDatabaseClient(),
      await createUiCommandContext(),
      { classroomId },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <TeacherAccessGate code={error.code} returnPath={`/teacher/classrooms/${classroomId}/members`} />;
    }
    if (error instanceof TeacherClassroomRosterQueryError || error instanceof ZodError) notFound();
    throw error;
  }

  return (
    <TeacherPage
      actorName={roster.actor.displayName}
      breadcrumb={[teacherHomeCrumb, { label: roster.classroom.name }]}
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>教师工作台 / 班级成员</p>
            <h1>{roster.classroom.name}</h1>
            <p>通过预配置名单码管理既有学生账号；每次变更都需确认并保留历史区间。</p>
          </div>
          <Link className={styles.rowLink} href="/teacher">返回教师工作台</Link>
        </header>
        <RosterManager roster={roster} />
      </div>
    </TeacherPage>
  );
}
