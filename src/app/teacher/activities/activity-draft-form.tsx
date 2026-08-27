"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  assignmentSubtypes,
  assignmentTypes,
  crossDisciplinaryConcepts,
  disciplineCatalog,
  evidenceTypes,
  inquiryDepths,
  submissionModes,
  type ActivityContentV2,
  type DisciplineCode,
} from "../../../domain/activity/activity-content";
import { saveActivityDraftAction } from "./actions";
import {
  createBlankPhase,
  normalizeTaskBookValues,
  type ActivityDraftActionState,
} from "./activity-draft-action-state";
import styles from "../teacher-workspace.module.css";

const statusLabels = { EDITING: "编辑中", READY_FOR_PREVIEW: "可预览", SEALED: "已封存" } as const;
const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;
function Section({ number, title, detail, children }: { number: number; title: string; detail: string; children: React.ReactNode }) {
  return <section className={styles.formSection}>
    <span className={styles.formIndex} aria-hidden="true">{String(number).padStart(2, "0")}</span>
    <div className={styles.formField}>
      <label>{title}</label><small>{detail}</small>{children}
    </div>
  </section>;
}

export function ActivityDraftForm({ initialState }: { initialState: ActivityDraftActionState }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveActivityDraftAction, initialState);
  const [values, setValues] = useState(initialState.values);
  const hydrated = useSyncExternalStore(subscribeToHydration, hydratedSnapshot, serverSnapshot);
  const activeValues = values;
  const isSealed = state.persistedStatus === "SEALED";
  const isConflict = state.status === "conflict";
  const draftHref = state.draftId ? `/teacher/activities/${state.draftId}` : null;
  const stageDisciplines = useMemo(() => disciplineCatalog.filter((discipline) => discipline.stages.some((stage) => stage === activeValues.schoolStage)), [activeValues.schoolStage]);
  const grades = activeValues.schoolStage === "PRIMARY" ? [1, 2, 3, 4, 5, 6] : [7, 8, 9];

  useEffect(() => {
    if (state.status === "success" && initialState.draftId === null && state.draftId) router.replace(`/teacher/activities/${state.draftId}`);
  }, [initialState.draftId, router, state]);

  const update = <K extends keyof ActivityContentV2>(key: K, value: ActivityContentV2[K]) => setValues((current) => ({ ...current, [key]: value }));
  const updatePhase = (index: number, patch: Partial<ActivityContentV2["phases"][number]>) => setValues((current) => ({ ...current, phases: current.phases.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, ...patch } : phase) }));
  const addPhase = () => setValues((current) => current.phases.length >= 4 ? current : ({ ...current, phases: [...current.phases, createBlankPhase("公开表达与反思")] }));
  const removePhase = (index: number) => setValues((current) => current.phases.length <= 3 ? current : ({ ...current, phases: current.phases.filter((_, phaseIndex) => phaseIndex !== index) }));
  const addEvidence = (phaseIndex: number) => setValues((current) => ({
    ...current,
    phases: current.phases.map((phase, index) => index !== phaseIndex || phase.evidence.length >= 4
      ? phase
      : { ...phase, evidence: [...phase.evidence, { type: "text", description: "" }] }),
  }));
  const removeEvidence = (phaseIndex: number, evidenceIndex: number) => setValues((current) => ({
    ...current,
    phases: current.phases.map((phase, index) => index !== phaseIndex || phase.evidence.length <= 1
      ? phase
      : { ...phase, evidence: phase.evidence.filter((_, itemIndex) => itemIndex !== evidenceIndex) }),
  }));
  const updateRubric = (index: number, key: keyof ActivityContentV2["rubricDimensions"][number], value: string) => setValues((current) => ({ ...current, rubricDimensions: current.rubricDimensions.map((dimension, dimensionIndex) => dimensionIndex === index ? { ...dimension, [key]: value } : dimension) }));
  const disabled = pending || isConflict || isSealed;
  const normalized = normalizeTaskBookValues(activeValues);

  function changeStage(stage: "PRIMARY" | "MIDDLE") {
    const stageChoices = disciplineCatalog.filter((discipline) => discipline.stages.some((itemStage) => itemStage === stage));
    const main = stageChoices.some((discipline) => discipline.code === activeValues.mainDisciplineCode) ? activeValues.mainDisciplineCode : stageChoices[0]!.code;
    const integrated = activeValues.integratedDisciplineCodes.filter((code) => code !== main && stageChoices.some((discipline) => discipline.code === code));
    setValues((current) => ({ ...current, schoolStage: stage, grade: stage === "PRIMARY" ? Math.min(current.grade, 6) : Math.max(current.grade, 7), mainDisciplineCode: main, integratedDisciplineCodes: integrated.length > 0 ? integrated : [stageChoices.find((discipline) => discipline.code !== main)!.code] }));
  }

  return <div className={styles.editorLayout}>
    <form id="activity-draft-form" data-hydrated={hydrated ? "true" : "false"} className={styles.editorForm} action={formAction}>
      <input type="hidden" name="draftId" value={state.draftId ?? ""} />
      <input type="hidden" name="expectedVersion" value={state.expectedVersion ?? ""} />
      <input type="hidden" name="idempotencyKey" value={state.nextIdempotencyKey} />
      <input type="hidden" name="content" value={JSON.stringify(normalized)} />

      <Section number={1} title="基本设置" detail="沿用原版 CTS 的学段、学科、作业类型和周期；截止时间仍在发布时设置。">
        <div className={styles.taskGrid}>
          <label>活动标题<input id="activity-title" value={activeValues.title} onChange={(event) => update("title", event.target.value)} disabled={disabled} maxLength={120} required /></label>
          <label>探究主题<input value={activeValues.topic} onChange={(event) => update("topic", event.target.value)} disabled={disabled} maxLength={160} required /></label>
          <label className={styles.taskFull}>任务描述<textarea id="activity-summary" value={activeValues.summary} onChange={(event) => update("summary", event.target.value)} disabled={disabled} maxLength={600} required /></label>
          <label>学段<select value={activeValues.schoolStage} onChange={(event) => changeStage(event.target.value as "PRIMARY" | "MIDDLE")} disabled={disabled}><option value="PRIMARY">小学</option><option value="MIDDLE">初中</option></select></label>
          <label>年级<select value={activeValues.grade} onChange={(event) => update("grade", Number(event.target.value))} disabled={disabled}>{grades.map((grade) => <option value={grade} key={grade}>{grade} 年级</option>)}</select></label>
          <label>主学科<select value={activeValues.mainDisciplineCode} onChange={(event) => { const main = event.target.value as DisciplineCode; setValues((current) => ({ ...current, mainDisciplineCode: main, integratedDisciplineCodes: current.integratedDisciplineCodes.filter((code) => code !== main) })); }} disabled={disabled}>{stageDisciplines.map((discipline) => <option value={discipline.code} key={discipline.code}>{discipline.label}</option>)}</select></label>
          <label className={styles.taskFull}>作业类型<select value={activeValues.assignmentType} onChange={(event) => { const assignmentType = event.target.value as ActivityContentV2["assignmentType"]; update("assignmentType", assignmentType); update("assignmentSubtype", assignmentType === "practical" ? "observation" : assignmentType === "inquiry" ? "survey" : null); }} disabled={disabled}>{assignmentTypes.map((type) => <option value={type.code} key={type.code}>{type.label}：{type.description}</option>)}</select></label>
          {activeValues.assignmentType !== "project" ? <label>作业子类型<select value={activeValues.assignmentSubtype ?? ""} onChange={(event) => update("assignmentSubtype", event.target.value as ActivityContentV2["assignmentSubtype"])} disabled={disabled}>{assignmentSubtypes[activeValues.assignmentType].map((type) => <option value={type.code} key={type.code}>{type.label}</option>)}</select></label> : null}
          <label className={styles.taskFull}>探究深度<select value={activeValues.inquiryDepth} onChange={(event) => update("inquiryDepth", event.target.value as ActivityContentV2["inquiryDepth"])} disabled={disabled}>{inquiryDepths.map((depth) => <option value={depth.code} key={depth.code}>{depth.label}：{depth.description}</option>)}</select></label>
          <label>提交模式<select value={activeValues.submissionMode} onChange={(event) => update("submissionMode", event.target.value as ActivityContentV2["submissionMode"])} disabled={disabled}>{submissionModes.map((mode) => <option value={mode.code} key={mode.code}>{mode.label}</option>)}</select></label>
          <label>周期（周）<input type="number" min="1" max="16" value={activeValues.durationWeeks} onChange={(event) => update("durationWeeks", Number(event.target.value))} disabled={disabled} required /></label>
        </div>
        <fieldset className={styles.optionFieldset}><legend>融合学科（至少一项）</legend><div className={styles.optionList}>{stageDisciplines.filter((discipline) => discipline.code !== activeValues.mainDisciplineCode).map((discipline) => <label key={discipline.code}><input type="checkbox" checked={activeValues.integratedDisciplineCodes.includes(discipline.code)} disabled={disabled} onChange={() => setValues((current) => ({ ...current, integratedDisciplineCodes: current.integratedDisciplineCodes.includes(discipline.code) ? current.integratedDisciplineCodes.filter((code) => code !== discipline.code) : [...current.integratedDisciplineCodes, discipline.code] }))} />{discipline.label}</label>)}</div></fieldset>
        <fieldset className={styles.optionFieldset}><legend>跨学科概念（可选，最多两项）</legend><div className={styles.optionList}>{crossDisciplinaryConcepts.map((concept) => <label key={concept.code}><input type="checkbox" checked={activeValues.crossDisciplinaryConceptCodes.includes(concept.code)} disabled={disabled || (!activeValues.crossDisciplinaryConceptCodes.includes(concept.code) && activeValues.crossDisciplinaryConceptCodes.length >= 2)} onChange={() => setValues((current) => ({ ...current, crossDisciplinaryConceptCodes: current.crossDisciplinaryConceptCodes.includes(concept.code) ? current.crossDisciplinaryConceptCodes.filter((code) => code !== concept.code) : [...current.crossDisciplinaryConceptCodes, concept.code] }))} />{concept.label}：{concept.description}</label>)}</div></fieldset>
      </Section>

      <Section number={2} title="背景与三维目标" detail="背景会单独展示给学生；目标保留知识与技能、过程与方法、情感态度三个维度。">
        <label>背景设定<textarea value={activeValues.backgroundSetting} onChange={(event) => update("backgroundSetting", event.target.value)} disabled={disabled} required /></label>
        <div className={styles.taskGrid}>
          <label>知识与技能目标<textarea value={activeValues.objectiveKnowledge} onChange={(event) => update("objectiveKnowledge", event.target.value)} disabled={disabled} required /></label>
          <label>过程与方法目标<textarea value={activeValues.objectiveProcess} onChange={(event) => update("objectiveProcess", event.target.value)} disabled={disabled} required /></label>
          <label className={styles.taskFull}>情感态度目标<textarea value={activeValues.objectiveEmotion} onChange={(event) => update("objectiveEmotion", event.target.value)} disabled={disabled} required /></label>
        </div>
      </Section>

      <Section number={3} title="任务链" detail="设置 3–4 个连续阶段。每阶段一个明确行动，并写清情境、支架、证据、评价要点和课时建议。">
        <label>总体任务说明<textarea data-long="true" value={activeValues.taskInstructions} onChange={(event) => update("taskInstructions", event.target.value)} disabled={disabled} required /></label>
        <div className={styles.phaseList}>{activeValues.phases.map((phase, index) => <fieldset className={styles.phaseCard} key={index}><legend>阶段 {index + 1}</legend>{activeValues.phases.length > 3 ? <button type="button" className={styles.secondaryButton} onClick={() => removePhase(index)} disabled={disabled}>移除本阶段</button> : null}<div className={styles.taskGrid}>
          <label>阶段名称<input value={phase.name} onChange={(event) => updatePhase(index, { name: event.target.value })} disabled={disabled} required /></label>
          <label>课时建议<input type="number" min="1" max="16" value={phase.suggestedLessons} onChange={(event) => updatePhase(index, { suggestedLessons: Number(event.target.value) })} disabled={disabled} required /></label>
          <label className={styles.taskFull}>核心动作<textarea value={phase.action} onChange={(event) => updatePhase(index, { action: event.target.value })} disabled={disabled} required /></label>
          <label>情境承接<textarea value={phase.context} onChange={(event) => updatePhase(index, { context: event.target.value })} disabled={disabled} required /></label>
          <label>学习支架<textarea value={phase.support} onChange={(event) => updatePhase(index, { support: event.target.value })} disabled={disabled} required /></label>
          <label className={styles.taskFull}>评价要点<textarea value={phase.evaluationFocus} onChange={(event) => updatePhase(index, { evaluationFocus: event.target.value })} disabled={disabled} required /></label>
          <div className={styles.taskFull}>{phase.evidence.map((evidence, evidenceIndex) => <div className={styles.taskGrid} key={evidenceIndex}>
            <label>提交证据类型<select value={evidence.type} onChange={(event) => updatePhase(index, { evidence: phase.evidence.map((item, itemIndex) => itemIndex === evidenceIndex ? { ...item, type: event.target.value as ActivityContentV2["phases"][number]["evidence"][number]["type"] } : item) })} disabled={disabled}>{evidenceTypes.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</select></label>
            <label>提交证据说明<textarea value={evidence.description} onChange={(event) => updatePhase(index, { evidence: phase.evidence.map((item, itemIndex) => itemIndex === evidenceIndex ? { ...item, description: event.target.value } : item) })} disabled={disabled} required /></label>
            {phase.evidence.length > 1 ? <button type="button" className={styles.secondaryButton} onClick={() => removeEvidence(index, evidenceIndex)} disabled={disabled}>移除这项证据</button> : null}
          </div>)}</div>
          {phase.evidence.length < 4 ? <button type="button" className={styles.secondaryButton} onClick={() => addEvidence(index)} disabled={disabled}>添加证据</button> : null}
        </div></fieldset>)}</div>
        {activeValues.phases.length < 4 ? <button type="button" className={styles.secondaryButton} onClick={addPhase} disabled={disabled}>添加第 4 阶段</button> : null}
      </Section>

      <Section number={4} title="评价量规" detail="四项默认维度均保留优秀、良好、合格、需改进四档描述，学生会在发布任务书中看到这些成功标准。">
        <div className={styles.rubricList}>{activeValues.rubricDimensions.map((dimension, index) => <fieldset className={styles.rubricCard} key={index}><legend>维度 {index + 1}</legend><div className={styles.taskGrid}>
          <label className={styles.taskFull}>评价维度<input value={dimension.name} onChange={(event) => updateRubric(index, "name", event.target.value)} disabled={disabled} required /></label>
          {(["excellent", "good", "pass", "improve"] as const).map((level) => <label key={level}>{({ excellent: "优秀", good: "良好", pass: "合格", improve: "需改进" })[level]}<textarea value={dimension[level]} onChange={(event) => updateRubric(index, level, event.target.value)} disabled={disabled} required /></label>)}
        </div></fieldset>)}</div>
      </Section>

      {!isSealed ? <div className={styles.actionStack}>
        <button className={styles.secondaryButton} type="submit" name="desiredStatus" value="EDITING" disabled={pending || isConflict}>{pending ? "正在保存…" : "保存为编辑中"}</button>
        <button className={styles.primaryButton} type="submit" name="desiredStatus" value="READY_FOR_PREVIEW" disabled={pending || isConflict}>{pending ? "正在保存…" : "保存并标记可预览"}</button>
      </div> : null}
    </form>

    <aside className={styles.editorRail} aria-label="草稿状态与下一步">
      <p className={styles.eyebrow}>草稿状态</p><h2>{state.persistedStatus ? statusLabels[state.persistedStatus] : "尚未创建"}</h2>
      <p>{state.expectedVersion ? `当前以版本 ${state.expectedVersion} 为保存基准。每次成功保存都会追加不可变修订。` : "第一次保存会创建版本 1 与对应的不可变修订。"}</p>
      {state.status !== "idle" ? <div className={styles.actionNotice} data-status={state.status} role={state.status === "success" ? "status" : "alert"} aria-live="polite"><span aria-hidden="true">{state.status === "success" ? "✓" : state.status === "conflict" ? "↻" : "!"}</span><p>{state.message}</p></div> : null}
      {isConflict && draftHref ? <Link className={styles.conflictLink} href={draftHref} target="_blank" rel="noreferrer">在新标签页打开最新版本</Link> : null}
      <div className={styles.actionStack}>{state.draftId && state.persistedStatus === "READY_FOR_PREVIEW" ? <Link className={styles.primaryLink} href={`/teacher/activities/${state.draftId}/preview`}>查看发布预览 <span aria-hidden="true">→</span></Link> : null}{state.persistedStatus === "SEALED" && state.draftId ? <Link className={styles.secondaryButton} href={`/teacher/activities/${state.draftId}/preview`}>查看已封存内容</Link> : null}<Link className={styles.secondaryButton} href="/teacher">返回教师工作台</Link></div>
    </aside>
  </div>;
}
