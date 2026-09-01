"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  assignmentSubtypes,
  assignmentTypes,
  disciplineCatalog,
  disciplineLabel,
  inquiryDepths,
  submissionModes,
  v3EvidenceTypes,
  type ActivityContentV3,
  type DisciplineCode,
} from "../../../domain/activity/activity-content";
import { coreCompetenciesForDiscipline } from "../../../domain/curriculum/core-competencies";
import {
  createBlankLearningGoal,
  nextLearningGoalId,
  createBlankPhase,
  createBlankRubricDimension,
  normalizeV3Values,
  type ActivityDraftV3ActionState,
} from "./activity-draft-v3-state";
import { saveActivityDraftV3Action } from "./v3-actions";
import styles from "../teacher-workspace.module.css";

const statusLabels = {
  EDITING: "编辑中",
  READY_FOR_PREVIEW: "可预览",
  SEALED: "已封存",
} as const;

function Section({
  number,
  title,
  detail,
  children,
}: {
  number: number;
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.formSection}>
      <span className={styles.formIndex} aria-hidden="true">
        {String(number).padStart(2, "0")}
      </span>
      <div className={styles.formField}>
        <label>{title}</label>
        <small>{detail}</small>
        {children}
      </div>
    </section>
  );
}

export function ActivityDraftV3Form({
  initialState,
}: {
  initialState: ActivityDraftV3ActionState;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    saveActivityDraftV3Action,
    initialState,
  );
  const [values, setValues] = useState(initialState.values);

  const isSealed = state.persistedStatus === "SEALED";
  const isConflict = state.status === "conflict";
  const disabled = pending || isConflict || isSealed;
  const draftHref = state.draftId ? `/teacher/activities/${state.draftId}` : null;

  useEffect(() => {
    if (state.status === "success" && initialState.draftId === null && state.draftId) {
      router.replace(`/teacher/activities/${state.draftId}`);
    }
  }, [initialState.draftId, router, state]);

  const stageDisciplines = useMemo(
    () =>
      disciplineCatalog.filter((discipline) =>
        discipline.stages.some((stage) => stage === values.schoolStage),
      ),
    [values.schoolStage],
  );
  const grades = values.schoolStage === "PRIMARY" ? [1, 2, 3, 4, 5, 6] : [7, 8, 9];
  const selectedDisciplines = useMemo<DisciplineCode[]>(
    () => [values.mainDisciplineCode, ...values.integratedDisciplineCodes],
    [values.mainDisciplineCode, values.integratedDisciplineCodes],
  );
  const normalized = useMemo(() => normalizeV3Values(values), [values]);

  const update = <K extends keyof ActivityContentV3>(
    key: K,
    value: ActivityContentV3[K],
  ) => setValues((current) => normalizeV3Values({ ...current, [key]: value }));

  const updateAt = <K extends "learningGoals" | "phases" | "rubricDimensions">(
    key: K,
    index: number,
    patch: Partial<ActivityContentV3[K][number]>,
  ) =>
    setValues((current) => ({
      ...current,
      [key]: current[key].map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));

  function changeStage(stage: "PRIMARY" | "MIDDLE") {
    const choices = disciplineCatalog.filter((discipline) =>
      discipline.stages.some((itemStage) => itemStage === stage),
    );
    const main = choices.some(
      (discipline) => discipline.code === values.mainDisciplineCode,
    )
      ? values.mainDisciplineCode
      : choices[0]!.code;
    const integrated = values.integratedDisciplineCodes.filter(
      (code) => code !== main && choices.some((discipline) => discipline.code === code),
    );
    setValues((current) =>
      normalizeV3Values({
        ...current,
        schoolStage: stage,
        grade: stage === "PRIMARY" ? Math.min(current.grade, 6) : Math.max(current.grade, 7),
        mainDisciplineCode: main,
        integratedDisciplineCodes:
          integrated.length > 0
            ? integrated
            : [choices.find((discipline) => discipline.code !== main)!.code],
      }),
    );
  }

  function toggleIntegrated(code: DisciplineCode) {
    setValues((current) => {
      const present = current.integratedDisciplineCodes.includes(code);
      if (present && current.integratedDisciplineCodes.length <= 1) {
        return current;
      }
      return normalizeV3Values({
        ...current,
        integratedDisciplineCodes: present
          ? current.integratedDisciplineCodes.filter((item) => item !== code)
          : [...current.integratedDisciplineCodes, code],
      });
    });
  }

  function toggleGoalLink(
    key: "phases" | "rubricDimensions",
    index: number,
    goalId: string,
  ) {
    setValues((current) => ({
      ...current,
      [key]: current[key].map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }
        const linked = item.learningGoalIds.includes(goalId);
        return {
          ...item,
          learningGoalIds: linked
            ? item.learningGoalIds.filter((id) => id !== goalId)
            : [...item.learningGoalIds, goalId],
        };
      }),
    }));
  }

  const goalLabel = (id: string) => {
    const index = values.learningGoals.findIndex((goal) => goal.id === id);
    return index < 0 ? id : `目标 ${index + 1}`;
  };

  return (
    <div className={styles.editorLayout}>
      <form
        id="activity-draft-v3-form"
        className={styles.editorForm}
        action={formAction}
      >
        <input type="hidden" name="draftId" value={state.draftId ?? ""} />
        <input
          type="hidden"
          name="expectedVersion"
          value={state.expectedVersion ?? ""}
        />
        <input type="hidden" name="idempotencyKey" value={state.nextIdempotencyKey} />
        <input type="hidden" name="content" value={JSON.stringify(normalized)} />

        <Section
          number={1}
          title="基本信息"
          detail="设置学段、学科、任务类型与周期；截止时间在发布时设置。"
        >
          <div className={styles.taskGrid}>
            <label>
              任务标题
              <input
                value={values.title}
                onChange={(event) => update("title", event.target.value)}
                disabled={disabled}
                maxLength={120}
                required
              />
            </label>
            <label>
              任务主题
              <input
                value={values.topic}
                onChange={(event) => update("topic", event.target.value)}
                disabled={disabled}
                maxLength={160}
                required
              />
            </label>
          </div>
          <label className={styles.taskFull}>
            任务描述
            <textarea
              value={values.summary}
              onChange={(event) => update("summary", event.target.value)}
              disabled={disabled}
              maxLength={600}
              rows={3}
              required
            />
          </label>
          <div className={styles.taskGrid}>
            <label>
              学段
              <select
                value={values.schoolStage}
                onChange={(event) =>
                  changeStage(event.target.value as "PRIMARY" | "MIDDLE")
                }
                disabled={disabled}
              >
                <option value="PRIMARY">小学</option>
                <option value="MIDDLE">初中</option>
              </select>
            </label>
            <label>
              年级
              <select
                value={values.grade}
                onChange={(event) => update("grade", Number(event.target.value))}
                disabled={disabled}
              >
                {grades.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade} 年级
                  </option>
                ))}
              </select>
            </label>
            <label>
              主学科
              <select
                value={values.mainDisciplineCode}
                onChange={(event) =>
                  update("mainDisciplineCode", event.target.value as DisciplineCode)
                }
                disabled={disabled}
              >
                {stageDisciplines.map((discipline) => (
                  <option key={discipline.code} value={discipline.code}>
                    {discipline.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              任务类型
              <select
                value={values.assignmentType}
                onChange={(event) =>
                  update(
                    "assignmentType",
                    event.target.value as ActivityContentV3["assignmentType"],
                  )
                }
                disabled={disabled}
              >
                {assignmentTypes.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>
            {values.assignmentType !== "project" ? (
              <label>
                任务子类型
                <select
                  value={values.assignmentSubtype ?? ""}
                  onChange={(event) =>
                    update(
                      "assignmentSubtype",
                      event.target
                        .value as ActivityContentV3["assignmentSubtype"],
                    )
                  }
                  disabled={disabled}
                >
                  {assignmentSubtypes[
                    values.assignmentType as "practical" | "inquiry"
                  ].map((subtype) => (
                    <option key={subtype.code} value={subtype.code}>
                      {subtype.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {values.assignmentType === "inquiry" ? (
              <label>
                探究深度
                <select
                  value={values.inquiryDepth ?? "basic"}
                  onChange={(event) =>
                    update(
                      "inquiryDepth",
                      event.target.value as ActivityContentV3["inquiryDepth"],
                    )
                  }
                  disabled={disabled}
                >
                  {inquiryDepths.map((depth) => (
                    <option key={depth.code} value={depth.code}>
                      {depth.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              提交模式
              <select
                value={values.submissionMode}
                onChange={(event) =>
                  update(
                    "submissionMode",
                    event.target.value as ActivityContentV3["submissionMode"],
                  )
                }
                disabled={disabled}
              >
                {submissionModes.map((mode) => (
                  <option key={mode.code} value={mode.code}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              周期（周）
              <input
                type="number"
                min={1}
                max={16}
                value={values.durationWeeks}
                onChange={(event) =>
                  update("durationWeeks", Number(event.target.value))
                }
                disabled={disabled}
              />
            </label>
          </div>
          <fieldset className={styles.optionFieldset}>
            <legend>融合学科（至少一项）</legend>
            <div className={styles.optionList}>
              {stageDisciplines
                .filter((discipline) => discipline.code !== values.mainDisciplineCode)
                .map((discipline) => (
                  <label key={discipline.code}>
                    <input
                      type="checkbox"
                      checked={values.integratedDisciplineCodes.includes(discipline.code)}
                      onChange={() => toggleIntegrated(discipline.code)}
                      disabled={disabled}
                    />
                    {discipline.label}
                  </label>
                ))}
            </div>
          </fieldset>
        </Section>

        <Section
          number={2}
          title="学习目标与跨学科设计"
          detail="每条目标关联 1–3 条适配学段年级的官方核心素养；每门已选学科都要说明贡献与不可替代性。"
        >
          <label className={styles.taskFull}>
            背景设定
            <textarea
              value={values.backgroundSetting}
              onChange={(event) => update("backgroundSetting", event.target.value)}
              disabled={disabled}
              maxLength={1200}
              rows={3}
              required
            />
          </label>

          <ul className={styles.phaseList}>
            {normalized.disciplineContributions.map((item, index) => (
              <li className={styles.phaseCard} key={item.disciplineCode}>
                <p className={styles.eyebrow}>{disciplineLabel(item.disciplineCode)}</p>
                <label>
                  学科贡献
                  <textarea
                    value={item.contribution}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        disciplineContributions: current.disciplineContributions.map(
                          (entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, contribution: event.target.value }
                              : entry,
                        ),
                      }))
                    }
                    disabled={disabled}
                    maxLength={500}
                    rows={2}
                    required
                  />
                </label>
                <label>
                  不可替代性
                  <textarea
                    value={item.necessity}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        disciplineContributions: current.disciplineContributions.map(
                          (entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, necessity: event.target.value }
                              : entry,
                        ),
                      }))
                    }
                    disabled={disabled}
                    maxLength={500}
                    rows={2}
                    required
                  />
                </label>
              </li>
            ))}
          </ul>

          <ul className={styles.phaseList}>
            {values.learningGoals.map((goal, index) => (
              <li className={styles.phaseCard} key={goal.id}>
                <p className={styles.eyebrow}>学习目标 {index + 1}</p>
                <label>
                  可观察目标
                  <textarea
                    value={goal.description}
                    onChange={(event) =>
                      updateAt("learningGoals", index, {
                        description: event.target.value,
                      })
                    }
                    disabled={disabled}
                    maxLength={500}
                    rows={2}
                    required
                  />
                </label>
                <fieldset className={styles.optionFieldset}>
                  <legend>课程依据（核心素养，1–3 条）</legend>
                  <div className={styles.optionList}>
                    {selectedDisciplines.flatMap((code) =>
                      coreCompetenciesForDiscipline(
                        code,
                        values.schoolStage,
                        values.grade,
                      ).map((competency) => {
                        const checked = goal.competencyReferences.some(
                          (reference) =>
                            reference.disciplineCode === code &&
                            reference.competencyCode === competency.code,
                        );
                        return (
                          <label key={`${code}-${competency.code}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={
                                disabled ||
                                (!checked && goal.competencyReferences.length >= 3)
                              }
                              onChange={() =>
                                updateAt("learningGoals", index, {
                                  competencyReferences: checked
                                    ? goal.competencyReferences.filter(
                                        (reference) =>
                                          !(
                                            reference.disciplineCode === code &&
                                            reference.competencyCode === competency.code
                                          ),
                                      )
                                    : [
                                        ...goal.competencyReferences,
                                        {
                                          disciplineCode: code,
                                          competencyCode: competency.code,
                                        },
                                      ],
                                })
                              }
                            />
                            {disciplineLabel(code)}·{competency.name}
                          </label>
                        );
                      }),
                    )}
                  </div>
                </fieldset>
                {values.learningGoals.length > 2 ? (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() =>
                      setValues((current) =>
                        normalizeV3Values({
                          ...current,
                          learningGoals: current.learningGoals.filter(
                            (_, goalIndex) => goalIndex !== index,
                          ),
                        }),
                      )
                    }
                    disabled={disabled}
                  >
                    删除本目标
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {values.learningGoals.length < 8 ? (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  learningGoals: [
                    ...current.learningGoals,
                    createBlankLearningGoal(nextLearningGoalId(current.learningGoals)),
                  ],
                }))
              }
              disabled={disabled}
            >
              添加学习目标
            </button>
          ) : null}
        </Section>

        <Section
          number={3}
          title="阶段任务与学习证据"
          detail="每个阶段说明它服务哪些目标；证据只用当前真实支持的四种类型。"
        >
          <label className={styles.taskFull}>
            总体任务说明
            <textarea
              value={values.taskInstructions}
              onChange={(event) => update("taskInstructions", event.target.value)}
              disabled={disabled}
              maxLength={5000}
              rows={4}
              required
            />
          </label>
          <ul className={styles.phaseList}>
            {values.phases.map((phase, index) => (
              <li className={styles.phaseCard} key={`phase-${index}`}>
                <p className={styles.eyebrow}>阶段 {index + 1}</p>
                <div className={styles.taskGrid}>
                  <label>
                    阶段名称
                    <input
                      value={phase.name}
                      onChange={(event) =>
                        updateAt("phases", index, { name: event.target.value })
                      }
                      disabled={disabled}
                      maxLength={80}
                      required
                    />
                  </label>
                  <label>
                    课时建议
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={phase.suggestedLessons}
                      onChange={(event) =>
                        updateAt("phases", index, {
                          suggestedLessons: Number(event.target.value),
                        })
                      }
                      disabled={disabled}
                    />
                  </label>
                </div>
                <label>
                  核心动作
                  <textarea
                    value={phase.action}
                    onChange={(event) =>
                      updateAt("phases", index, { action: event.target.value })
                    }
                    disabled={disabled}
                    maxLength={300}
                    rows={2}
                    required
                  />
                </label>
                <label>
                  情境承接
                  <textarea
                    value={phase.context}
                    onChange={(event) =>
                      updateAt("phases", index, { context: event.target.value })
                    }
                    disabled={disabled}
                    maxLength={500}
                    rows={2}
                    required
                  />
                </label>
                <label>
                  学习支架
                  <textarea
                    value={phase.support}
                    onChange={(event) =>
                      updateAt("phases", index, { support: event.target.value })
                    }
                    disabled={disabled}
                    maxLength={500}
                    rows={2}
                    required
                  />
                </label>
                <label>
                  评价要点
                  <textarea
                    value={phase.evaluationFocus}
                    onChange={(event) =>
                      updateAt("phases", index, {
                        evaluationFocus: event.target.value,
                      })
                    }
                    disabled={disabled}
                    maxLength={300}
                    rows={2}
                    required
                  />
                </label>
                <fieldset className={styles.optionFieldset}>
                  <legend>本阶段服务的学习目标</legend>
                  <div className={styles.optionList}>
                    {values.learningGoals.map((goal) => (
                      <label key={goal.id}>
                        <input
                          type="checkbox"
                          checked={phase.learningGoalIds.includes(goal.id)}
                          onChange={() => toggleGoalLink("phases", index, goal.id)}
                          disabled={disabled}
                        />
                        {goalLabel(goal.id)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className={styles.optionFieldset}>
                  <legend>需提交的学习证据</legend>
                  {phase.evidence.map((evidence, evidenceIndex) => (
                    <div className={styles.taskGrid} key={`evidence-${evidenceIndex}`}>
                      <label>
                        证据类型
                        <select
                          value={evidence.type}
                          onChange={(event) =>
                            updateAt("phases", index, {
                              evidence: phase.evidence.map((item, itemIndex) =>
                                itemIndex === evidenceIndex
                                  ? {
                                      ...item,
                                      type: event.target
                                        .value as (typeof v3EvidenceTypes)[number]["code"],
                                    }
                                  : item,
                              ),
                            })
                          }
                          disabled={disabled}
                        >
                          {v3EvidenceTypes.map((type) => (
                            <option key={type.code} value={type.code}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        任务要求
                        <input
                          value={evidence.description}
                          onChange={(event) =>
                            updateAt("phases", index, {
                              evidence: phase.evidence.map((item, itemIndex) =>
                                itemIndex === evidenceIndex
                                  ? { ...item, description: event.target.value }
                                  : item,
                              ),
                            })
                          }
                          disabled={disabled}
                          maxLength={300}
                          required
                        />
                      </label>
                    </div>
                  ))}
                  {phase.evidence.length < 4 ? (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() =>
                        updateAt("phases", index, {
                          evidence: [
                            ...phase.evidence,
                            { type: "text", description: "" },
                          ],
                        })
                      }
                      disabled={disabled}
                    >
                      添加证据要求
                    </button>
                  ) : null}
                </fieldset>
              </li>
            ))}
          </ul>
          {values.phases.length < 4 ? (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  phases: [...current.phases, createBlankPhase("公开表达与反思")],
                }))
              }
              disabled={disabled}
            >
              添加阶段
            </button>
          ) : null}
        </Section>

        <Section
          number={4}
          title="评价量规"
          detail="每个维度关联至少一个学习目标；学生端显示优秀／良好／达标／需改进。"
        >
          <ul className={styles.rubricList}>
            {values.rubricDimensions.map((dimension, index) => (
              <li className={styles.rubricCard} key={`rubric-${index}`}>
                <label>
                  评价维度
                  <input
                    value={dimension.name}
                    onChange={(event) =>
                      updateAt("rubricDimensions", index, { name: event.target.value })
                    }
                    disabled={disabled}
                    maxLength={100}
                    required
                  />
                </label>
                {(
                  [
                    ["excellent", "优秀"],
                    ["good", "良好"],
                    ["pass", "达标"],
                    ["improve", "需改进"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <textarea
                      value={dimension[key]}
                      onChange={(event) =>
                        updateAt("rubricDimensions", index, {
                          [key]: event.target.value,
                        })
                      }
                      disabled={disabled}
                      maxLength={300}
                      rows={2}
                      required
                    />
                  </label>
                ))}
                <fieldset className={styles.optionFieldset}>
                  <legend>本维度评价的学习目标</legend>
                  <div className={styles.optionList}>
                    {values.learningGoals.map((goal) => (
                      <label key={goal.id}>
                        <input
                          type="checkbox"
                          checked={dimension.learningGoalIds.includes(goal.id)}
                          onChange={() =>
                            toggleGoalLink("rubricDimensions", index, goal.id)
                          }
                          disabled={disabled}
                        />
                        {goalLabel(goal.id)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {values.rubricDimensions.length > 4 ? (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        rubricDimensions: current.rubricDimensions.filter(
                          (_, dimensionIndex) => dimensionIndex !== index,
                        ),
                      }))
                    }
                    disabled={disabled}
                  >
                    删除本维度
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {values.rubricDimensions.length < 8 ? (
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() =>
                setValues((current) => ({
                  ...current,
                  rubricDimensions: [
                    ...current.rubricDimensions,
                    createBlankRubricDimension(""),
                  ],
                }))
              }
              disabled={disabled}
            >
              添加评价维度
            </button>
          ) : null}
        </Section>

        <div className={styles.actionStack}>
          <button
            className={styles.secondaryButton}
            type="submit"
            name="desiredStatus"
            value="EDITING"
            disabled={disabled}
          >
            保存为编辑中
          </button>
          <button
            className={styles.primaryButton}
            type="submit"
            name="desiredStatus"
            value="READY_FOR_PREVIEW"
            disabled={disabled}
          >
            保存并标记可预览
          </button>
        </div>
      </form>

      <aside className={styles.editorRail}>
        <p className={styles.eyebrow}>v3 草稿状态</p>
        <h2>
          {state.persistedStatus ? statusLabels[state.persistedStatus] : "尚未创建"}
        </h2>
        <p>保存会生成新修订；已封存的历史和哈希不会被改写。</p>
        {state.message ? (
          <p className={styles.actionNotice} role="status">
            {state.message}
          </p>
        ) : null}
        {isConflict && draftHref ? (
          <Link className={styles.conflictLink} href={draftHref}>
            打开最新版本核对
          </Link>
        ) : null}
        <Link className={styles.primaryLink} href="/teacher/activities">
          返回跨学科任务
        </Link>
      </aside>
    </div>
  );
}
