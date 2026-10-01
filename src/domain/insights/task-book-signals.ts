import type { ActivityContentV3 } from "../activity/activity-content";
import type { AnswerThemeKind } from "./answer-themes";
import { isMostlyLow, type ReleaseDiagnosis } from "./release-diagnosis";

/**
 * What one release's classroom data says about its task book (D-088). Each
 * signal points at a field, named the same way a version diagnosis names its
 * targets (D-068), so it can sit next to that field in a copied draft and be
 * handed to the diagnosis as evidence.
 *
 * Only signals that plausibly trace back to how the task book is written are
 * included. Who is late or stalled is about the class, not the document.
 */
export type TaskBookSignal = Readonly<{
  target: string;
  kind: "EVIDENCE_SKIPPED" | "DIMENSION_LOW" | "ANSWER_GAP";
  text: string;
}>;

export type AnswerThemesForSignals = ReadonlyArray<{
  phaseIndex: number;
  latest: {
    themes: ReadonlyArray<{
      kind: AnswerThemeKind;
      statement: string;
      sources: ReadonlyArray<unknown>;
    }>;
  } | null;
}>;

export function buildTaskBookSignals(
  diagnosis: Pick<ReleaseDiagnosis, "evidence" | "matrix">,
  answerPhases: AnswerThemesForSignals,
): TaskBookSignal[] {
  const signals: TaskBookSignal[] = [];

  for (const phase of diagnosis.evidence) {
    for (const item of phase.items) {
      if (!isMostlyLow(phase.submittedCount, item.missing.length)) continue;
      signals.push({
        target: `phases.${phase.phaseIndex}.evidence.${item.evidenceIndex}`,
        kind: "EVIDENCE_SKIPPED",
        text: `已交的 ${phase.submittedCount} 份里有 ${item.missing.length} 份没有勾选这项证据。`,
      });
    }
  }

  for (const dimension of diagnosis.matrix.dimensions) {
    if (!dimension.weak) continue;
    signals.push({
      target: `rubricDimensions.${dimension.dimensionIndex}`,
      kind: "DIMENSION_LOW",
      text:
        `${dimension.sampleCount} 份相关评价里有 ${dimension.lowCount} 份落在低档` +
        `（需改进 ${dimension.improve} 份，证据不足 ${dimension.insufficient} 份）。`,
    });
  }

  for (const phase of answerPhases) {
    for (const theme of phase.latest?.themes ?? []) {
      if (theme.kind !== "GAP") continue;
      signals.push({
        // The whole-task submission answers the overall instructions.
        target: phase.phaseIndex === 0 ? "taskInstructions" : `phases.${phase.phaseIndex}`,
        kind: "ANSWER_GAP",
        text: `AI 归纳的作答共同缺口（出自 ${theme.sources.length} 份作答的原文）：${theme.statement}`,
      });
    }
  }

  return signals;
}

/** The text a target stood for, so a later draft can tell whether it changed. */
export function taskBookFieldAt(
  content: ActivityContentV3,
  target: string,
): string | null {
  if (target === "taskInstructions") return content.taskInstructions;
  const match = /^(phases|rubricDimensions)\.(\d+)(?:\.evidence\.(\d+))?$/u.exec(target);
  if (!match) return null;
  const index = Number(match[2]) - 1;
  if (match[1] === "rubricDimensions") {
    const dimension = content.rubricDimensions[index];
    return dimension && match[3] === undefined ? JSON.stringify(dimension) : null;
  }
  const phase = content.phases[index];
  if (!phase) return null;
  if (match[3] === undefined) return JSON.stringify(phase);
  const evidence = phase.evidence[Number(match[3]) - 1];
  return evidence ? JSON.stringify(evidence) : null;
}

export type CarriedTaskBookSignal = TaskBookSignal &
  Readonly<{
    /** How the field was named in the release the signal came from. */
    sourceLabel: string;
    /**
     * unchanged: the draft still says what the release said there.
     * changed: the teacher has edited that field since.
     * removed: the draft no longer has a field at that position.
     */
    state: "unchanged" | "changed" | "removed";
  }>;

/**
 * Carry a release's signals onto a draft copied from it. Positions are all a
 * copy shares with its source, so a signal follows its position and says
 * honestly when the text there is no longer what the students were given.
 */
export function carryTaskBookSignals(
  signals: ReadonlyArray<TaskBookSignal & { sourceLabel: string }>,
  releaseContent: ActivityContentV3,
  draftContent: ActivityContentV3,
): CarriedTaskBookSignal[] {
  return signals.map((signal) => {
    const before = taskBookFieldAt(releaseContent, signal.target);
    const now = taskBookFieldAt(draftContent, signal.target);
    return {
      ...signal,
      state: now === null ? "removed" : now === before ? "unchanged" : "changed",
    };
  });
}
