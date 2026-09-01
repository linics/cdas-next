import {
  assignmentSubtypeLabel,
  assignmentTypeDetails,
  disciplineLabel,
  inquiryDepths,
  submissionModes,
  v3EvidenceTypeLabel,
  type ActivityContentV3,
} from "../../domain/activity/activity-content";
import {
  coreCompetencySourceLocator,
  findCoreCompetency,
} from "../../domain/curriculum/core-competencies";

/**
 * The read-only v3 task book, shared by the teacher preview and the student
 * activity page so the two can never drift into describing the same published
 * snapshot differently.
 *
 * v3 shows 达标 where v1 and v2 said 合格; the older wording stays on older
 * snapshots because those are sealed history, not a style choice.
 */
export function TaskBookV3View({
  content,
  showBackground = true,
}: {
  content: ActivityContentV3;
  showBackground?: boolean;
}) {
  const goalName = new Map(
    content.learningGoals.map((goal, index) => [goal.id, `目标 ${index + 1}`]),
  );

  return (
    <>
      <section>
        <h3>基本设置</h3>
        <p>{content.topic}</p>
        <p>
          {content.schoolStage === "PRIMARY" ? "小学" : "初中"} {content.grade} 年级；
          主学科 {disciplineLabel(content.mainDisciplineCode)}；融合学科 {content.integratedDisciplineCodes.map(disciplineLabel).join("、")}；
          {assignmentTypeDetails(content.assignmentType).label}
          {assignmentSubtypeLabel(content.assignmentType, content.assignmentSubtype)
            ? ` · ${assignmentSubtypeLabel(content.assignmentType, content.assignmentSubtype)}`
            : ""}
          {content.inquiryDepth
            ? ` · ${inquiryDepths.find((item) => item.code === content.inquiryDepth)?.label ?? content.inquiryDepth}`
            : ""}
          {` · ${submissionModes.find((item) => item.code === content.submissionMode)?.label ?? content.submissionMode} · ${content.durationWeeks} 周`}
        </p>
        <p>{assignmentTypeDetails(content.assignmentType).description}</p>
      </section>

      {showBackground ? (
        <section>
          <h3>背景设定</h3>
          <p>{content.backgroundSetting}</p>
        </section>
      ) : null}

      <section>
        <h3>总体任务</h3>
        <p>{content.taskInstructions}</p>
      </section>

      <section>
        <h3>学习目标与课程依据</h3>
        <ol>
          {content.learningGoals.map((goal, index) => (
            <li key={goal.id}>
              <strong>目标 {index + 1}</strong>：{goal.description}
              <br />
              课程依据：
              {goal.competencyReferences
                .map((reference) => {
                  const competency = findCoreCompetency(
                    reference.disciplineCode,
                    reference.competencyCode,
                  );
                  if (!competency) {
                    return null;
                  }
                  return `${disciplineLabel(reference.disciplineCode)}·${competency.name}（${coreCompetencySourceLocator(competency)}）`;
                })
                .filter((label) => label !== null)
                .join("；")}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3>学科分工</h3>
        <ul>
          {content.disciplineContributions.map((item) => (
            <li key={item.disciplineCode}>
              <strong>{disciplineLabel(item.disciplineCode)}</strong>
              <br />
              贡献：{item.contribution}
              <br />
              不可替代性：{item.necessity}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>阶段任务</h3>
        <ol>
          {content.phases.map((phase) => (
            <li key={phase.name}>
              <strong>{phase.name}</strong>
              <br />
              服务目标：
              {phase.learningGoalIds
                .map((id) => goalName.get(id) ?? id)
                .join("、")}
              <br />
              行动：{phase.action}
              <br />
              情境：{phase.context}
              <br />
              支架：{phase.support}
              <br />
              需提交：
              {phase.evidence
                .map(
                  (evidence) =>
                    `${v3EvidenceTypeLabel(evidence.type)}：${evidence.description}`,
                )
                .join("；")}
              <br />
              评价要点：{phase.evaluationFocus}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3>评价标准</h3>
        <ul>
          {content.rubricDimensions.map((dimension) => (
            <li key={dimension.name}>
              <strong>{dimension.name}</strong>
              <br />
              评价目标：
              {dimension.learningGoalIds
                .map((id) => goalName.get(id) ?? id)
                .join("、")}
              <br />
              优秀：{dimension.excellent}
              <br />
              良好：{dimension.good}
              <br />
              达标：{dimension.pass}
              <br />
              需改进：{dimension.improve}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
