"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  assignmentSubtypes,
  assignmentTypes,
  crossDisciplinaryConcepts,
  disciplineCatalog,
  disciplineLabel,
  evidenceTypes,
  supportedEvidenceTypes,
  inquiryDepths,
  submissionModes,
  type ActivityContentV2,
  type ActivityContentV3,
  type DisciplineCode,
} from "../../../domain/activity/activity-content";
import { coreCompetenciesForDiscipline } from "../../../domain/curriculum/core-competencies";
import { saveActivityDraftAction } from "./actions";
import {
  normalizeTaskBookValues,
  upgradeTaskBookV2ToV3,
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
  const [upgradeValues, setUpgradeValues] = useState<ActivityContentV3 | null>(null);
  if (upgradeValues || initialState.values.schemaVersion === 3) {
    return <ActivityDraftV3Form initialState={{ ...initialState, values: upgradeValues ?? initialState.values as ActivityContentV3 }} />;
  }
  return <LegacyV2ActivityDraftForm initialState={initialState} onUpgrade={setUpgradeValues} />;
}

function LegacyV2ActivityDraftForm({ initialState, onUpgrade }: { initialState: ActivityDraftActionState; onUpgrade: (values: ActivityContentV3) => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveActivityDraftAction, initialState);
  const [values, setValues] = useState(initialState.values as ActivityContentV2);
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
  const addPhase = () => setValues((current) => current.phases.length >= 4 ? current : ({ ...current, phases: [...current.phases, { name: "公开表达与反思", action: "", context: "", support: "", evidence: [{ type: "text", description: "" }], evaluationFocus: "", suggestedLessons: 1 }] }));
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

      <Section number={1} title="基本设置" detail="设置学段、学科、作业类型与周期；截止时间在发布时设置。">
        <p className={styles.legacyUpgradeNotice}>这是仍可编辑的 v2 草稿。确认升级后，请在同一份草稿补齐核心素养、学科贡献和目标关联，再保存为 v3 修订；旧修订不会被改写。</p>
        <button type="button" className={styles.secondaryButton} onClick={() => onUpgrade(upgradeTaskBookV2ToV3(activeValues))} disabled={disabled}>显式升级到 v3</button>
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

      <Section number={2} title="背景与三维目标" detail="背景将单独展示给学生；目标涵盖知识与技能、过程与方法、情感态度三个维度。">
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

      <Section number={4} title="评价量规" detail="每个维度包含优秀、良好、合格、需改进四档描述；学生会在任务书中看到这些标准。">
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
      <p>{state.expectedVersion ? `当前基于版本 ${state.expectedVersion} 编辑；每次保存都会生成新版本，历史版本保留。` : "首次保存将创建版本 1。"}</p>
      {state.status !== "idle" ? <div className={styles.actionNotice} data-status={state.status} role={state.status === "success" ? "status" : "alert"} aria-live="polite"><span aria-hidden="true">{state.status === "success" ? "✓" : state.status === "conflict" ? "↻" : "!"}</span><p>{state.message}</p></div> : null}
      {isConflict && draftHref ? <Link className={styles.conflictLink} href={draftHref} target="_blank" rel="noreferrer">在新标签页打开最新版本</Link> : null}
      <div className={styles.actionStack}>{state.draftId && state.persistedStatus === "READY_FOR_PREVIEW" ? <Link className={styles.primaryLink} href={`/teacher/activities/${state.draftId}/preview`}>查看发布预览 <span aria-hidden="true">→</span></Link> : null}{state.persistedStatus === "SEALED" && state.draftId ? <Link className={styles.secondaryButton} href={`/teacher/activities/${state.draftId}/preview`}>查看已封存内容</Link> : null}<Link className={styles.secondaryButton} href="/teacher/activities">返回活动设计</Link></div>
    </aside>
  </div>;
}

function ActivityDraftV3Form({ initialState }: { initialState: ActivityDraftActionState & { values: ActivityContentV3 } }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveActivityDraftAction, initialState);
  const [values, setValues] = useState<ActivityContentV3>(initialState.values);
  const hydrated = useSyncExternalStore(subscribeToHydration, hydratedSnapshot, serverSnapshot);
  const disabled = pending || state.status === "conflict" || state.persistedStatus === "SEALED";
  const selectedDisciplines = [values.mainDisciplineCode, ...values.integratedDisciplineCodes];
  const usableCompetencyDisciplines = selectedDisciplines.filter((code) => code !== "integrated");
  const stageDisciplines = disciplineCatalog.filter((discipline) => discipline.stages.some((stage) => stage === values.schoolStage));

  useEffect(() => {
    if (state.status === "success" && initialState.draftId === null && state.draftId) router.replace(`/teacher/activities/${state.draftId}`);
  }, [initialState.draftId, router, state]);

  const setField = <K extends keyof ActivityContentV3>(key: K, value: ActivityContentV3[K]) => setValues((current) => ({ ...current, [key]: value }));
  const syncContributions = (mainDisciplineCode: ActivityContentV3["mainDisciplineCode"], integratedDisciplineCodes: ActivityContentV3["integratedDisciplineCodes"]) => setValues((current) => {
    const codes = [mainDisciplineCode, ...integratedDisciplineCodes];
    return {
      ...current,
      mainDisciplineCode,
      integratedDisciplineCodes,
      disciplineContributions: codes.map((disciplineCode) => current.disciplineContributions.find((item) => item.disciplineCode === disciplineCode) ?? { disciplineCode, contribution: "", necessity: "" }),
    };
  });
  const toggleGoalLink = (ids: string[], id: string) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
  const updatePhase = (index: number, patch: Partial<ActivityContentV3["phases"][number]>) => setValues((current) => ({ ...current, phases: current.phases.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, ...patch } : phase) }));
  const updateRubric = (index: number, patch: Partial<ActivityContentV3["rubricDimensions"][number]>) => setValues((current) => ({ ...current, rubricDimensions: current.rubricDimensions.map((dimension, dimensionIndex) => dimensionIndex === index ? { ...dimension, ...patch } : dimension) }));
  const addGoal = () => setValues((current) => {
    if (current.learningGoals.length >= 8) return current;
    const disciplineCode = [current.mainDisciplineCode, ...current.integratedDisciplineCodes].find((code) => coreCompetenciesForDiscipline(code, current.schoolStage, current.grade).length > 0);
    const competency = disciplineCode ? coreCompetenciesForDiscipline(disciplineCode, current.schoolStage, current.grade)[0] : null;
    if (!disciplineCode || !competency) return current;
    const nextNumber = current.learningGoals.length + 1;
    return { ...current, learningGoals: [...current.learningGoals, { id: `goal-${nextNumber}`, description: "", competencyReferences: [{ disciplineCode, competencyCode: competency.code }] }] };
  });
  const addGoalReference = (goalIndex: number) => setValues((current) => {
    const goal = current.learningGoals[goalIndex];
    if (!goal || goal.competencyReferences.length >= 3) return current;
    const disciplineCode = [current.mainDisciplineCode, ...current.integratedDisciplineCodes].find((code) => coreCompetenciesForDiscipline(code, current.schoolStage, current.grade).length > 0);
    const competency = disciplineCode ? coreCompetenciesForDiscipline(disciplineCode, current.schoolStage, current.grade)[0] : null;
    if (!disciplineCode || !competency) return current;
    return { ...current, learningGoals: current.learningGoals.map((item, index) => index === goalIndex ? { ...item, competencyReferences: [...item.competencyReferences, { disciplineCode, competencyCode: competency.code }] } : item) };
  });
  const addPhase = () => setValues((current) => current.phases.length >= 4 ? current : ({ ...current, phases: [...current.phases, { name: "成果完善与反思", action: "", context: "", support: "", learningGoalIds: [current.learningGoals[0]!.id], evidence: [{ type: "text", description: "" }], evaluationFocus: "", suggestedLessons: 1 }] }));
  const addEvidence = (phaseIndex: number) => setValues((current) => ({ ...current, phases: current.phases.map((phase, index) => index === phaseIndex && phase.evidence.length < 4 ? { ...phase, evidence: [...phase.evidence, { type: "text", description: "" }] } : phase) }));
  const addRubric = () => setValues((current) => current.rubricDimensions.length >= 8 ? current : ({ ...current, rubricDimensions: [...current.rubricDimensions, { name: "", excellent: "", good: "", pass: "", improve: "", learningGoalIds: [current.learningGoals[0]!.id] }] }));
  const normalized = normalizeTaskBookValues(values);

  return <div className={styles.editorLayout}>
    <form id="activity-draft-form" data-hydrated={hydrated ? "true" : "false"} className={styles.editorForm} action={formAction}>
      <input type="hidden" name="draftId" value={state.draftId ?? ""} />
      <input type="hidden" name="expectedVersion" value={state.expectedVersion ?? ""} />
      <input type="hidden" name="idempotencyKey" value={state.nextIdempotencyKey} />
      <input type="hidden" name="content" value={JSON.stringify(normalized)} />
      <nav aria-label="任务书区块"><a href="#basic">基本信息</a> · <a href="#goals">学习目标与跨学科设计</a> · <a href="#phases">阶段任务</a> · <a href="#evidence">学习证据</a> · <a href="#rubric">评价量规</a></nav>

      <section id="basic" className={styles.formSection}><span className={styles.formIndex}>01</span><div className={styles.formField}>
        <label>基本信息</label><small>v3 任务书使用目标关联与真实支持的证据能力；截止时间仍在发布时设置。</small>
        <div className={styles.taskGrid}>
          <label>任务标题<input value={values.title} onChange={(event) => setField("title", event.target.value)} disabled={disabled} required /></label>
          <label>任务主题<input value={values.topic} onChange={(event) => setField("topic", event.target.value)} disabled={disabled} required /></label>
          <label className={styles.taskFull}>任务描述<textarea value={values.summary} onChange={(event) => setField("summary", event.target.value)} disabled={disabled} required /></label>
          <label>学段<select value={values.schoolStage} onChange={(event) => { const stage = event.target.value as ActivityContentV3["schoolStage"]; const choices = disciplineCatalog.filter((item) => (item.stages as readonly ActivityContentV3["schoolStage"][]).includes(stage)); const main = choices.some((item) => item.code === values.mainDisciplineCode) ? values.mainDisciplineCode : choices[0]!.code; syncContributions(main, values.integratedDisciplineCodes.filter((code) => code !== main && choices.some((item) => item.code === code))); setField("schoolStage", stage); setField("grade", stage === "PRIMARY" ? Math.min(values.grade, 6) : Math.max(values.grade, 7)); }} disabled={disabled}><option value="PRIMARY">小学</option><option value="MIDDLE">初中</option></select></label>
          <label>年级<select value={values.grade} onChange={(event) => setField("grade", Number(event.target.value))} disabled={disabled}>{(values.schoolStage === "PRIMARY" ? [1,2,3,4,5,6] : [7,8,9]).map((grade) => <option value={grade} key={grade}>{grade} 年级</option>)}</select></label>
          <label>主学科<select value={values.mainDisciplineCode} onChange={(event) => { const main = event.target.value as ActivityContentV3["mainDisciplineCode"]; syncContributions(main, values.integratedDisciplineCodes.filter((code) => code !== main)); }} disabled={disabled}>{stageDisciplines.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label>
          <label>任务类型<select value={values.assignmentType} onChange={(event) => { const assignmentType = event.target.value as ActivityContentV3["assignmentType"]; setValues((current) => ({ ...current, assignmentType, assignmentSubtype: assignmentType === "project" ? null : assignmentType === "inquiry" ? "survey" : "observation", inquiryDepth: assignmentType === "inquiry" ? "basic" : null })); }} disabled={disabled}>{assignmentTypes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          {values.assignmentType !== "project" ? <label>任务子类型<select value={values.assignmentSubtype ?? ""} onChange={(event) => setField("assignmentSubtype", event.target.value as ActivityContentV3["assignmentSubtype"])} disabled={disabled}>{assignmentSubtypes[values.assignmentType].map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label> : null}
          {values.assignmentType === "inquiry" ? <label>探究深度<select value={values.inquiryDepth ?? "basic"} onChange={(event) => setField("inquiryDepth", event.target.value as ActivityContentV3["inquiryDepth"])} disabled={disabled}>{inquiryDepths.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label> : null}
          <label>提交模式<select value={values.submissionMode} onChange={(event) => setField("submissionMode", event.target.value as ActivityContentV3["submissionMode"])} disabled={disabled}>{submissionModes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label>周期（周）<input type="number" min="1" max="16" value={values.durationWeeks} onChange={(event) => setField("durationWeeks", Number(event.target.value))} disabled={disabled} /></label>
        </div>
        <fieldset className={styles.optionFieldset}><legend>融合学科</legend><div className={styles.optionList}>{stageDisciplines.filter((item) => item.code !== values.mainDisciplineCode).map((item) => <label key={item.code}><input type="checkbox" checked={values.integratedDisciplineCodes.includes(item.code)} disabled={disabled} onChange={() => syncContributions(values.mainDisciplineCode, values.integratedDisciplineCodes.includes(item.code) ? values.integratedDisciplineCodes.filter((code) => code !== item.code) : [...values.integratedDisciplineCodes, item.code])} />{item.label}</label>)}</div>{values.integratedDisciplineCodes.length >= 3 ? <small>已选择三门及以上融合学科，请逐项确认其不可替代性，避免装饰性叠加。</small> : null}</fieldset>
      </div></section>

      <section id="goals" className={styles.formSection}><span className={styles.formIndex}>02</span><div className={styles.formField}>
        <label>学习目标与跨学科设计</label><small>每项目标均需关联 1–3 条适配学段和年级的官方核心素养；每门已选学科均须说明贡献与不可替代性。</small>
        <label>背景设定<textarea value={values.backgroundSetting} onChange={(event) => setField("backgroundSetting", event.target.value)} disabled={disabled} required /></label>
        <div className={styles.phaseList}>{values.disciplineContributions.map((item, index) => <fieldset className={styles.phaseCard} key={item.disciplineCode}><legend>{disciplineLabel(item.disciplineCode)}</legend><div className={styles.taskGrid}><label>学科贡献<textarea value={item.contribution} onChange={(event) => setField("disciplineContributions", values.disciplineContributions.map((value, itemIndex) => itemIndex === index ? { ...value, contribution: event.target.value } : value))} disabled={disabled} required /></label><label>不可替代性<textarea value={item.necessity} onChange={(event) => setField("disciplineContributions", values.disciplineContributions.map((value, itemIndex) => itemIndex === index ? { ...value, necessity: event.target.value } : value))} disabled={disabled} required /></label></div></fieldset>)}</div>
        <div className={styles.phaseList}>{values.learningGoals.map((goal, goalIndex) => <fieldset className={styles.phaseCard} key={goal.id}><legend>学习目标 {goalIndex + 1}</legend><div className={styles.taskGrid}><label className={styles.taskFull}>可观察目标<textarea value={goal.description} onChange={(event) => setField("learningGoals", values.learningGoals.map((value, index) => index === goalIndex ? { ...value, description: event.target.value } : value))} disabled={disabled} required /></label>{goal.competencyReferences.map((reference, refIndex) => <div className={styles.taskGrid} key={`${goal.id}-${refIndex}`}><label>学科<select value={reference.disciplineCode} onChange={(event) => { const disciplineCode = event.target.value as ActivityContentV3["mainDisciplineCode"]; const first = coreCompetenciesForDiscipline(disciplineCode, values.schoolStage, values.grade)[0]; setField("learningGoals", values.learningGoals.map((value, index) => index === goalIndex ? { ...value, competencyReferences: value.competencyReferences.map((ref, index) => index === refIndex ? { disciplineCode, competencyCode: first?.code ?? "" } : ref) } : value)); }} disabled={disabled}>{usableCompetencyDisciplines.map((code) => <option value={code} key={code}>{disciplineLabel(code)}</option>)}</select></label><label>核心素养<select value={reference.competencyCode} onChange={(event) => setField("learningGoals", values.learningGoals.map((value, index) => index === goalIndex ? { ...value, competencyReferences: value.competencyReferences.map((ref, index) => index === refIndex ? { ...ref, competencyCode: event.target.value } : ref) } : value))} disabled={disabled}>{coreCompetenciesForDiscipline(reference.disciplineCode, values.schoolStage, values.grade).map((competency) => <option value={competency.code} key={competency.code}>{competency.name}</option>)}</select></label></div>)}{goal.competencyReferences.length < 3 ? <button type="button" className={styles.secondaryButton} onClick={() => addGoalReference(goalIndex)} disabled={disabled}>添加核心素养引用</button> : null}</div></fieldset>)}</div>
        {values.learningGoals.length < 8 ? <button type="button" className={styles.secondaryButton} onClick={addGoal} disabled={disabled}>添加学习目标</button> : null}
      </div></section>

      <section id="phases" className={styles.formSection}><span className={styles.formIndex}>03</span><div className={styles.formField}>
        <label>阶段任务</label><small>每个阶段明确连接其服务的学习目标；阶段证据将继承该关联。</small><label>总体任务说明<textarea value={values.taskInstructions} onChange={(event) => setField("taskInstructions", event.target.value)} disabled={disabled} required /></label>
        <div className={styles.phaseList}>{values.phases.map((phase, index) => <fieldset className={styles.phaseCard} key={phase.name}><legend>阶段 {index + 1}</legend><div className={styles.taskGrid}><label>阶段名称<input value={phase.name} onChange={(event) => updatePhase(index, { name: event.target.value })} disabled={disabled} /></label><label>课时建议<input type="number" min="1" max="16" value={phase.suggestedLessons} onChange={(event) => updatePhase(index, { suggestedLessons: Number(event.target.value) })} disabled={disabled} /></label><label className={styles.taskFull}>核心动作<textarea value={phase.action} onChange={(event) => updatePhase(index, { action: event.target.value })} disabled={disabled} /></label><label>情境承接<textarea value={phase.context} onChange={(event) => updatePhase(index, { context: event.target.value })} disabled={disabled} /></label><label>学习支架<textarea value={phase.support} onChange={(event) => updatePhase(index, { support: event.target.value })} disabled={disabled} /></label><label className={styles.taskFull}>评价要点<textarea value={phase.evaluationFocus} onChange={(event) => updatePhase(index, { evaluationFocus: event.target.value })} disabled={disabled} /></label></div><fieldset className={styles.optionFieldset}><legend>关联学习目标</legend><div className={styles.optionList}>{values.learningGoals.map((goal) => <label key={goal.id}><input type="checkbox" checked={phase.learningGoalIds.includes(goal.id)} onChange={() => updatePhase(index, { learningGoalIds: toggleGoalLink(phase.learningGoalIds, goal.id) })} disabled={disabled} />{goal.description || goal.id}</label>)}</div></fieldset></fieldset>)}</div>
        {values.phases.length < 4 ? <button type="button" className={styles.secondaryButton} onClick={addPhase} disabled={disabled}>添加阶段</button> : null}
      </div></section>

      <section id="evidence" className={styles.formSection}><span className={styles.formIndex}>04</span><div className={styles.formField}>
        <label>学习证据</label><small>任务要求、学生可提交和 AI 可读取严格区分：文字、图片、PDF/DOC/DOCX 可提交并可读取；现场确认只由教师确认；视频和结构化链接当前不提供上传或分析。</small>
        <div className={styles.phaseList}>{values.phases.map((phase, phaseIndex) => <fieldset className={styles.phaseCard} key={`${phase.name}-evidence`}><legend>{phase.name || `阶段 ${phaseIndex + 1}`} 的证据</legend>{phase.evidence.map((evidence, evidenceIndex) => <div className={styles.taskGrid} key={evidenceIndex}><label>证据类型<select value={evidence.type} onChange={(event) => updatePhase(phaseIndex, { evidence: phase.evidence.map((item, index) => index === evidenceIndex ? { ...item, type: event.target.value as typeof evidence.type } : item) })} disabled={disabled}>{supportedEvidenceTypes.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label><label>任务要求<textarea value={evidence.description} onChange={(event) => updatePhase(phaseIndex, { evidence: phase.evidence.map((item, index) => index === evidenceIndex ? { ...item, description: event.target.value } : item) })} disabled={disabled} required /></label></div>)}{phase.evidence.length < 4 ? <button type="button" className={styles.secondaryButton} onClick={() => addEvidence(phaseIndex)} disabled={disabled}>添加证据要求</button> : null}</fieldset>)}</div>
      </div></section>

      <section id="rubric" className={styles.formSection}><span className={styles.formIndex}>05</span><div className={styles.formField}>
        <label>评价量规</label><small>每个维度都必须关联至少一个学习目标；v3 前台显示「优秀／良好／达标／需改进」。</small>
        <div className={styles.rubricList}>{values.rubricDimensions.map((dimension, index) => <fieldset className={styles.rubricCard} key={dimension.name || index}><legend>维度 {index + 1}</legend><div className={styles.taskGrid}><label className={styles.taskFull}>评价维度<input value={dimension.name} onChange={(event) => updateRubric(index, { name: event.target.value })} disabled={disabled} /></label>{(["excellent", "good", "pass", "improve"] as const).map((level) => <label key={level}>{({excellent:"优秀",good:"良好",pass:"达标",improve:"需改进"})[level]}<textarea value={dimension[level]} onChange={(event) => updateRubric(index, { [level]: event.target.value })} disabled={disabled} /></label>)}</div><fieldset className={styles.optionFieldset}><legend>关联学习目标</legend><div className={styles.optionList}>{values.learningGoals.map((goal) => <label key={goal.id}><input type="checkbox" checked={dimension.learningGoalIds.includes(goal.id)} onChange={() => updateRubric(index, { learningGoalIds: toggleGoalLink(dimension.learningGoalIds, goal.id) })} disabled={disabled} />{goal.description || goal.id}</label>)}</div></fieldset></fieldset>)}</div>
        {values.rubricDimensions.length < 8 ? <button type="button" className={styles.secondaryButton} onClick={addRubric} disabled={disabled}>添加评价维度</button> : null}
      </div></section>
      {state.status !== "idle" ? <div className={styles.actionNotice} data-status={state.status} role="status"><p>{state.message}</p></div> : null}
      {state.persistedStatus !== "SEALED" ? <div className={styles.actionStack}><button className={styles.secondaryButton} type="submit" name="desiredStatus" value="EDITING" disabled={disabled}>保存为编辑中</button><button className={styles.primaryButton} type="submit" name="desiredStatus" value="READY_FOR_PREVIEW" disabled={disabled}>保存并标记可预览</button></div> : null}
    </form>
    <aside className={styles.editorRail} aria-label="草稿状态与下一步"><p className={styles.eyebrow}>v3 草稿状态</p><h2>{state.persistedStatus ? statusLabels[state.persistedStatus] : "尚未创建"}</h2><p>保存会生成新修订；已封存的历史和哈希不会被改写。</p><Link className={styles.secondaryButton} href="/teacher/activities">返回跨学科任务</Link></aside>
  </div>;
}
