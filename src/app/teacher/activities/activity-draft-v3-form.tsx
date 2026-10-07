"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import {
  describeTaskBookGaps,
  taskBookSections,
} from "../../../domain/activity/task-book-gaps";
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
import {
  autosaveTaskBookAction,
  discardTaskBookWorkingCopyAction,
} from "./working-copy-actions";
import { styles } from "../teacher-ui";

const statusLabels = {
  EDITING: "编辑中",
  READY_FOR_PREVIEW: "可预览",
  SEALED: "已封存",
} as const;
const AUTOSAVE_DELAY_MS = 1_500;
const AUTOSAVE_RETRY_MS = 10_000;
const VISIBLE_GAPS = 8;

/** The unsaved copy a form continues from, or one it must ask about first. */
export type TaskBookWorkingCopyProp = Readonly<{
  id: string;
  version: number;
  baseVersion: number;
  savedAt: string;
}>;

type AutosaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; savedAt: string }
  | { status: "failed"; message: string }
  | { status: "stale" };

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

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
    <section
      className={styles.formSection}
      id={`task-book-${taskBookSections[number - 1]?.key ?? number}`}
    >
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
  workingCopy = null,
  pendingCopy = null,
}: {
  initialState: ActivityDraftV3ActionState;
  /** D-093: the unsaved copy these values were restored from. */
  workingCopy?: TaskBookWorkingCopyProp | null;
  /** An unsaved copy made on an older version; the teacher chooses first. */
  pendingCopy?: TaskBookWorkingCopyProp | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    saveActivityDraftV3Action,
    initialState,
  );
  const [values, setValues] = useState(initialState.values);
  // Browser gates fill this form; typing before hydration is silently undone.
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    hydratedSnapshot,
    serverSnapshot,
  );

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
  const serialized = useMemo(() => JSON.stringify(normalized), [normalized]);
  const gaps = useMemo(() => describeTaskBookGaps(normalized), [normalized]);
  const [showGaps, setShowGaps] = useState(false);

  // D-093 autosave. What the server holds is tracked by content, so typing
  // during a save is picked up by the next one and an unchanged form sends
  // nothing. A copy made on an older version pauses autosave until the
  // teacher picks one, so neither version is overwritten behind their back.
  const [copy, setCopy] = useState(workingCopy);
  const [autosave, setAutosave] = useState<AutosaveState>(
    pendingCopy
      ? { status: "stale" }
      : workingCopy
        ? { status: "saved", savedAt: workingCopy.savedAt }
        : { status: "idle" },
  );
  const stored = useRef(serialized);
  const latest = useRef(serialized);
  const copyRef = useRef(copy);
  const inFlight = useRef(false);
  useEffect(() => {
    latest.current = serialized;
    copyRef.current = copy;
  });

  const runAutosave = useCallback(async () => {
    if (inFlight.current || latest.current === stored.current) return;
    inFlight.current = true;
    const content = latest.current;
    const current = copyRef.current;
    setAutosave({ status: "saving" });
    const result = await autosaveTaskBookAction({
      workingCopyId: current?.id ?? null,
      draftId: state.draftId,
      expectedVersion: current?.version ?? null,
      content,
    });
    inFlight.current = false;
    if (result.status === "saved") {
      stored.current = content;
      const next = {
        id: result.workingCopyId,
        version: result.version,
        baseVersion: current?.baseVersion ?? state.expectedVersion ?? 0,
        savedAt: result.savedAt,
      };
      copyRef.current = next;
      setCopy(next);
      setAutosave({ status: "saved", savedAt: result.savedAt });
      if (!state.draftId && !current) {
        window.history.replaceState(null, "", `/teacher/activities/new?wc=${result.workingCopyId}`);
      }
      // Anything typed during this save changes nothing here: the status
      // change re-runs the effect below, which sees the newer content.
    } else if (result.status === "stale") {
      setAutosave({ status: "stale" });
    } else {
      setAutosave({ status: "failed", message: result.message });
    }
  }, [state.draftId, state.expectedVersion]);

  const autosaveBlocked = autosave.status === "stale" || isSealed || isConflict;
  useEffect(() => {
    if (!hydrated || autosaveBlocked || pending || serialized === stored.current) return;
    const timer = window.setTimeout(
      () => void runAutosave(),
      autosave.status === "failed" ? AUTOSAVE_RETRY_MS : AUTOSAVE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [serialized, hydrated, autosaveBlocked, pending, autosave.status, runAutosave]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current !== stored.current && !autosaveBlocked) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [autosaveBlocked]);

  // A saved version absorbs the working copy; the server already dropped it.
  const [handledState, setHandledState] = useState(state);
  if (handledState !== state) {
    setHandledState(state);
    if (state.status === "success") {
      setCopy(null);
      setAutosave({ status: "idle" });
    }
  }
  useEffect(() => {
    if (state.status === "success") {
      stored.current = JSON.stringify(normalizeV3Values(state.values));
      copyRef.current = null;
    }
  }, [state]);

  const discardCopy = async (target: TaskBookWorkingCopyProp) => {
    const message = state.draftId
      ? `放弃没保存的修改，回到已保存的第 ${state.expectedVersion} 版？`
      : "删除这份还没保存的任务书？删除后无法找回。";
    if (!window.confirm(message)) return;
    const result = await discardTaskBookWorkingCopyAction({
      workingCopyId: target.id,
      draftId: state.draftId,
    });
    if (result.ok) {
      window.location.assign(
        state.draftId ? `/teacher/activities/${state.draftId}` : "/teacher/activities",
      );
    }
  };

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
        data-hydrated={hydrated ? "true" : "false"}
        className={styles.editorForm}
        action={formAction}
        onSubmit={(event) => {
          // A version must be complete; say what is missing instead of
          // sending it to be refused.
          if (gaps.length > 0) {
            event.preventDefault();
            setShowGaps(true);
            document
              .getElementById("task-book-gaps")
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }}
      >
        <input type="hidden" name="draftId" value={state.draftId ?? ""} />
        <input
          type="hidden"
          name="expectedVersion"
          value={state.expectedVersion ?? ""}
        />
        <input type="hidden" name="idempotencyKey" value={state.nextIdempotencyKey} />
        <input type="hidden" name="content" value={serialized} />
        <input type="hidden" name="workingCopyId" value={copy?.id ?? ""} />
        <input type="hidden" name="workingCopyVersion" value={copy?.version ?? ""} />

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
              />
            </label>
            <label>
              任务主题
              <input
                value={values.topic}
                onChange={(event) => update("topic", event.target.value)}
                disabled={disabled}
                maxLength={160}
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
        <p className={styles.eyebrow}>任务书状态</p>
        <h2>
          {state.persistedStatus
            ? statusLabels[state.persistedStatus]
            : copy
              ? "还没保存为版本"
              : "尚未创建"}
        </h2>
        {pendingCopy && autosave.status === "stale" ? (
          <div className={styles.actionNotice} role="alert">
            <p>
              你有一份基于第 {pendingCopy.baseVersion} 版、还没保存的修改（自动保存于{" "}
              {clockTime(pendingCopy.savedAt)}），而草稿后来已更新到第 {state.expectedVersion} 版。先选一份继续：
            </p>
            <p className="flex flex-wrap gap-2">
              <Link
                className={styles.secondaryButton}
                href={`/teacher/activities/${state.draftId}?restore=working-copy`}
              >
                载入没保存的修改
              </Link>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => void discardCopy(pendingCopy)}
              >
                放弃，用第 {state.expectedVersion} 版
              </button>
            </p>
          </div>
        ) : (
          <p role="status">
            {autosave.status === "saving"
              ? "正在自动保存…"
              : autosave.status === "saved"
                ? `已自动保存 · ${clockTime(autosave.savedAt)}`
                : autosave.status === "failed"
                  ? autosave.message
                  : autosave.status === "stale"
                    ? "这份任务书在别的页面有更新的修改，这里的自动保存已暂停。刷新页面后继续。"
                    : isSealed
                      ? "已发布的版本不再修改；要改动请复制为新活动。"
                      : "开始填写后会自动保存，只有你自己看得到。"}
          </p>
        )}
        {workingCopy && copy && state.draftId ? (
          <p className="text-sm text-muted-foreground">
            已恢复你上次没保存的修改。预览、版本检查和 AI 适配仍使用已保存的第 {state.expectedVersion} 版。
          </p>
        ) : null}
        {!isSealed ? (
          <div
            id="task-book-gaps"
            className={
              showGaps && gaps.length > 0
                ? "space-y-2 rounded-lg border border-destructive/40 p-3"
                : "space-y-2"
            }
          >
            {gaps.length === 0 ? (
              <p>内容已经齐全，可以保存为版本。</p>
            ) : (
              <>
                <p>
                  <strong>还差 {gaps.length} 项</strong>才能保存为版本：
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {gaps.slice(0, VISIBLE_GAPS).map((gap) => (
                    <li key={`${gap.section}-${gap.label}`}>
                      <a href={`#task-book-${gap.section}`}>{gap.label}</a>
                    </li>
                  ))}
                </ul>
                {gaps.length > VISIBLE_GAPS ? (
                  <p className="text-sm text-muted-foreground">另有 {gaps.length - VISIBLE_GAPS} 项。</p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <p>
          自动保存的内容只有你看得到，不能预览或发布。补齐后保存为版本，才能预览、发布或交给助手检查；之前的版本都会保留。
        </p>
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
        {state.draftId && state.persistedStatus === "READY_FOR_PREVIEW" ? (
          <Link
            className={styles.primaryLink}
            href={`/teacher/activities/${state.draftId}/preview`}
          >
            查看发布预览 <span aria-hidden="true">→</span>
          </Link>
        ) : null}
        {copy && !pendingCopy ? (
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void discardCopy(copy)}
          >
            {state.draftId ? "放弃没保存的修改" : "删除这份没保存的任务书"}
          </button>
        ) : null}
        <Link className={styles.primaryLink} href="/teacher/activities">
          返回跨学科任务
        </Link>
      </aside>
    </div>
  );
}
