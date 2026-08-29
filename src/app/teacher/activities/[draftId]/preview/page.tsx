import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import {
  assignmentTypeDetails,
  assignmentSubtypeLabel,
  crossDisciplinaryConcepts,
  disciplineLabel,
  evidenceTypeLabel,
  inquiryDepths,
  submissionModes,
} from "../../../../../domain/activity/activity-content";
import { AuthenticationError } from "../../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../../server/db/client";
import {
  getTeacherActivityPreview,
  TeacherActivityQueryError,
} from "../../../../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
  activityStudioCrumb,
  teacherHomeCrumb,
} from "../../../_components/teacher-shell";
import styles from "../../../teacher-workspace.module.css";
import { PublishPanel } from "./publish-panel";

export default async function TeacherActivityPreviewPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  let workspace;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    workspace = await getTeacherActivityPreview(database, context, { draftId });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <TeacherAccessGate
          code={error.code}
          returnPath={`/teacher/activities/${draftId}/preview`}
        />
      );
    }
    if (
      error instanceof TeacherActivityQueryError ||
      error instanceof ZodError
    ) {
      notFound();
    }
    throw error;
  }

  const content = workspace.draft.revision.content;
  return (
    <TeacherPage
      actorName={workspace.actor.displayName}
      breadcrumb={[
        teacherHomeCrumb,
        activityStudioCrumb,
        {
          href: `/teacher/activities/${workspace.draft.id}`,
          label: content.title,
        },
        { label: "发布预览" },
      ]}
    >
      <div className={styles.pageContent}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>发布管理 / 精确版本预览</p>
            <h1>{content.title}</h1>
            <p>
              此页读取草稿版本 {workspace.draft.version} 的精确不可变修订。准备与确认不会采用浏览器提交的正文。
            </p>
          </div>
          <Link
            className={styles.secondaryButton}
            href={`/teacher/activities/${workspace.draft.id}`}
          >
            ← 返回草稿
          </Link>
        </header>

        <div className={styles.previewLayout}>
          <article className={styles.snapshotSheet}>
            <header>
              <p className={styles.eyebrow}>草稿修订 {workspace.draft.version}</p>
              <h2>{content.title}</h2>
              <p>{content.summary}</p>
            </header>
            {content.schemaVersion === 2 ? <>
              <section>
                <h3>基本设置</h3>
                <div>
                  <p>{content.topic}</p>
                  <div className={styles.factTags}>
                    <span>{content.schoolStage === "PRIMARY" ? "小学" : "初中"} {content.grade} 年级</span>
                    <span>主学科 {disciplineLabel(content.mainDisciplineCode)}</span>
                    <span>融合 {content.integratedDisciplineCodes.map(disciplineLabel).join(" · ")}</span>
                    <span>{assignmentTypeDetails(content.assignmentType).label}</span>
                    {assignmentSubtypeLabel(content.assignmentType, content.assignmentSubtype) ? <span>{assignmentSubtypeLabel(content.assignmentType, content.assignmentSubtype)}</span> : null}
                    <span>{inquiryDepths.find((item) => item.code === content.inquiryDepth)?.label}</span>
                    <span>{submissionModes.find((item) => item.code === content.submissionMode)?.label}</span>
                    <span>{content.durationWeeks} 周</span>
                  </div>
                  <p>{assignmentTypeDetails(content.assignmentType).description}</p>
                </div>
              </section>
              {content.crossDisciplinaryConceptCodes.length > 0 ? <section><h3>跨学科概念</h3><p>{content.crossDisciplinaryConceptCodes.map((code) => { const concept = crossDisciplinaryConcepts.find((item) => item.code === code)!; return `${concept.label}（${concept.description}）`; }).join("；")}</p></section> : null}
              <section><h3>背景设定</h3><p>{content.backgroundSetting}</p></section>
              <section><h3>三维目标</h3><ol><li>知识与技能：{content.objectiveKnowledge}</li><li>过程与方法：{content.objectiveProcess}</li><li>情感态度：{content.objectiveEmotion}</li></ol></section>
              <section><h3>总体任务</h3><p>{content.taskInstructions}</p></section>
              <section><h3>任务链</h3><ol>{content.phases.map((phase) => <li key={phase.name}><strong>{phase.name}</strong><br />行动：{phase.action}<br />情境：{phase.context}<br />支架：{phase.support}<br />证据：{phase.evidence.map((evidence) => `${evidenceTypeLabel(evidence.type)}：${evidence.description}`).join("；")}<br />评价要点：{phase.evaluationFocus}</li>)}</ol></section>
              <section><h3>评价标准</h3><ul>{content.rubricDimensions.map((dimension) => <li key={dimension.name}><strong>{dimension.name}</strong>：优秀 {dimension.excellent}；良好 {dimension.good}；合格 {dimension.pass}；需改进 {dimension.improve}</li>)}</ul></section>
            </> : <>
              <section><h3>学习目标</h3><ol>{content.learningObjectives.map((item) => <li key={item}>{item}</li>)}</ol></section>
              <section><h3>任务说明</h3><p>{content.taskInstructions}</p></section>
              <section><h3>提交证据</h3><ul>{content.evidenceRequirements.map((item) => <li key={item}>{item}</li>)}</ul></section>
              <section><h3>教师反馈将关注</h3><ul>{content.feedbackCriteria.map((item) => <li key={item}>{item}</li>)}</ul></section>
            </>}
          </article>

          <PublishPanel
            workspace={workspace}
            initialPreparationState={{
              status: "idle",
              message: "",
              confirmation: null,
              selectedClassroomId: workspace.classrooms[0]?.id ?? "",
              dueAtInstant: "",
              nextPrepareIdempotencyKey: `prepare_publish_${randomUUID()}`,
            }}
          />
        </div>
      </div>
    </TeacherPage>
  );
}
