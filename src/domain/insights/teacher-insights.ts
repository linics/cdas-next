import type { TeacherEvaluationLevel } from "../evaluation/teacher-evaluation-policy";

export const INSIGHTS_MIN_SAMPLE = 3;

export type InsightsOutcome =
  | {
      dimensionIndex: number;
      dimensionName: string;
      status: "LEVEL";
      level: TeacherEvaluationLevel;
    }
  | {
      dimensionIndex: number;
      dimensionName: string;
      status: "INSUFFICIENT_EVIDENCE";
    };

export type InsightsSubmissionRevisionInput = Readonly<{
  revisionNumber: number;
  nextStep: "CONTINUE" | "REVISE" | null;
  outcomes: readonly InsightsOutcome[] | null;
}>;

export type InsightsSubmissionInput = Readonly<{
  id: string;
  phaseIndex: number;
  latestRevisionNumber: number;
  studentId: string | null;
  groupId: string | null;
  revisions: readonly InsightsSubmissionRevisionInput[];
}>;

export type InsightsReleaseInput = Readonly<{
  id: string;
  title: string;
  classroomName: string;
  executionVersion: 0 | 1;
  submissionMode: "once" | "phased" | "mixed";
  phases: readonly { name: string; learningGoalIds?: readonly string[] }[];
  rubricDimensions:
    | readonly { name: string; learningGoalIds?: readonly string[] }[]
    | null;
  groups: readonly { id: string; memberIds: readonly string[] }[];
  currentMemberIds: readonly string[];
  submissions: readonly InsightsSubmissionInput[];
}>;

export type InsightsReleaseOption = Readonly<{
  id: string;
  title: string;
  classroomName: string;
}>;

export type InsightsRubricDimension = Readonly<{
  dimensionIndex: number;
  dimensionName: string;
  /** Evaluations in which this dimension was relevant to the phase (D-076). */
  sampleCount: number;
  excellent: number;
  good: number;
  pass: number;
  improve: number;
  insufficient: number;
  weak: boolean;
}>;

export type InsightsRubricCard = Readonly<{
  releaseId: string;
  title: string;
  classroomName: string;
  status: "no_rubric" | "no_evaluations" | "ready";
  sampleCount: number;
  dimensions: readonly InsightsRubricDimension[];
}>;

export type InsightsStageBucket = Readonly<{
  key: string;
  label: string;
  count: number;
}>;

export type InsightsStageCard = Readonly<{
  releaseId: string;
  title: string;
  classroomName: string;
  audienceCount: number;
  buckets: readonly InsightsStageBucket[];
}>;

export type InsightsImprovement = Readonly<{
  reviseCount: number;
  resubmittedCount: number;
  evaluationPairs: number;
  rose: number;
  unchanged: number;
  fell: number;
}>;

export type TeacherInsightsView = Readonly<{
  selectedReleaseId: string | null;
  releaseOptions: readonly InsightsReleaseOption[];
  rubric: readonly InsightsRubricCard[];
  stages: readonly InsightsStageCard[];
  improvement: InsightsImprovement;
}>;

const LEVEL_RANK: Readonly<Record<TeacherEvaluationLevel, number>> = {
  improve: 0,
  pass: 1,
  good: 2,
  excellent: 3,
};

export function currentAudienceProgress(input: {
  executionVersion: 0 | 1;
  submissionMode: "once" | "phased" | "mixed";
  phaseCount: number;
  submissions: readonly {
    phaseIndex: number;
    latestRevisionNumber: number;
  }[];
}): {
  started: boolean;
  complete: boolean;
  currentPhaseIndex: number;
  completedPhaseCount: number;
} {
  const completedPhaseIndexes = new Set(
    input.submissions
      .filter(
        (submission) =>
          submission.phaseIndex > 0 && submission.latestRevisionNumber > 0,
      )
      .map((submission) => submission.phaseIndex),
  );
  const finalSubmitted = input.submissions.some(
    (submission) =>
      submission.phaseIndex === 0 && submission.latestRevisionNumber > 0,
  );
  const firstIncompletePhase = Array.from(
    { length: input.phaseCount },
    (_, index) => index + 1,
  ).find((phaseIndex) => !completedPhaseIndexes.has(phaseIndex));
  const complete =
    input.executionVersion === 0
      ? finalSubmitted
      : completedPhaseIndexes.size === input.phaseCount &&
        (input.submissionMode === "phased" || finalSubmitted);
  const currentPhaseIndex =
    input.executionVersion === 0
      ? 0
      : firstIncompletePhase ??
        (input.submissionMode === "mixed" ? 0 : Math.max(1, input.phaseCount));
  return {
    started: input.submissions.length > 0,
    complete,
    currentPhaseIndex,
    completedPhaseCount: completedPhaseIndexes.size,
  };
}

function currentRevision(
  submission: InsightsSubmissionInput,
): InsightsSubmissionRevisionInput | null {
  if (submission.latestRevisionNumber === 0) {
    return null;
  }
  return (
    submission.revisions.find(
      (revision) => revision.revisionNumber === submission.latestRevisionNumber,
    ) ?? null
  );
}

/**
 * Whether one evaluation places a dimension in the low band the insights card
 * counts as weak: 待改进 or 证据不足. Matched by index and name, exactly as the
 * card tallies, so a drill-down lists the same submissions the card counted.
 */
export function isLowBandOutcome(
  outcomes: readonly InsightsOutcome[],
  dimensionIndex: number,
  dimensionName: string,
): boolean {
  const outcome = outcomes.find(
    (item) =>
      item.dimensionIndex === dimensionIndex &&
      item.dimensionName === dimensionName,
  );
  return (
    outcome !== undefined &&
    (outcome.status === "INSUFFICIENT_EVIDENCE" || outcome.level === "improve")
  );
}

/**
 * Whether a rubric dimension speaks to a submission's phase (D-076). A v3
 * phase and a dimension both name the learning goals they serve; a phase-1
 * submission cannot show evidence for a dimension that only judges goals of
 * later phases, so its "证据不足" there says nothing about the student. The
 * whole-task submission (phase 0), v2 content and missing links count every
 * dimension.
 */
export function isDimensionRelevantToPhase(
  phaseGoalIds: readonly string[] | undefined,
  dimensionGoalIds: readonly string[] | undefined,
): boolean {
  if (!phaseGoalIds?.length || !dimensionGoalIds?.length) return true;
  return dimensionGoalIds.some((id) => phaseGoalIds.includes(id));
}

export function aggregateRubricCard(
  release: InsightsReleaseInput,
): InsightsRubricCard {
  const dimensions = release.rubricDimensions;
  if (!dimensions || dimensions.length === 0) {
    return {
      releaseId: release.id,
      title: release.title,
      classroomName: release.classroomName,
      status: "no_rubric",
      sampleCount: 0,
      dimensions: [],
    };
  }

  const samples = release.submissions.flatMap((submission) => {
    const outcomes = currentRevision(submission)?.outcomes;
    if (!outcomes) return [];
    const phaseGoalIds =
      submission.phaseIndex > 0
        ? release.phases[submission.phaseIndex - 1]?.learningGoalIds
        : undefined;
    return [{ outcomes, phaseGoalIds }];
  });

  const tallies = dimensions.map((dimension, index) => ({
    dimensionIndex: index + 1,
    dimensionName: dimension.name,
    goalIds: dimension.learningGoalIds,
    sampleCount: 0,
    excellent: 0,
    good: 0,
    pass: 0,
    improve: 0,
    insufficient: 0,
  }));

  for (const { outcomes, phaseGoalIds } of samples) {
    for (const tally of tallies) {
      if (!isDimensionRelevantToPhase(phaseGoalIds, tally.goalIds)) {
        continue;
      }
      const outcome = outcomes.find(
        (item) =>
          item.dimensionIndex === tally.dimensionIndex &&
          item.dimensionName === tally.dimensionName,
      );
      if (!outcome) {
        continue;
      }
      tally.sampleCount += 1;
      if (outcome.status === "INSUFFICIENT_EVIDENCE") {
        tally.insufficient += 1;
      } else {
        tally[outcome.level] += 1;
      }
    }
  }

  const weakIndex =
    samples.length === 0
      ? -1
      : tallies.reduce((weakest, tally, index) => {
          const current = tallies[weakest];
          if (!current) {
            return index;
          }
          if (tally.improve !== current.improve) {
            return tally.improve > current.improve ? index : weakest;
          }
          if (tally.insufficient !== current.insufficient) {
            return tally.insufficient > current.insufficient ? index : weakest;
          }
          return weakest;
        }, 0);
  const weakTally = weakIndex >= 0 ? tallies[weakIndex] : null;
  const hasLowBand =
    weakTally !== null &&
    samples.length > 0 &&
    (weakTally.improve > 0 || weakTally.insufficient > 0);

  return {
    releaseId: release.id,
    title: release.title,
    classroomName: release.classroomName,
    status: samples.length === 0 ? "no_evaluations" : "ready",
    sampleCount: samples.length,
    dimensions: tallies.map((tally, index) => ({
      dimensionIndex: tally.dimensionIndex,
      dimensionName: tally.dimensionName,
      sampleCount: tally.sampleCount,
      excellent: tally.excellent,
      good: tally.good,
      pass: tally.pass,
      improve: tally.improve,
      insufficient: tally.insufficient,
      weak: hasLowBand && index === weakIndex,
    })),
  };
}

/**
 * The stage bucket one audience (student or group) sits in. The insights card
 * counts with it and the roster's stage drill-down filters with it (D-070),
 * so both always agree on who is "stuck" where.
 */
export function stageBucketKey(
  progress: Readonly<{ complete: boolean; started: boolean; currentPhaseIndex: number }>,
  executionVersion: 0 | 1,
): string {
  if (progress.complete) return "complete";
  if (!progress.started) return "not_started";
  if (executionVersion === 0) return "in_progress";
  if (progress.currentPhaseIndex === 0) return "final";
  return `phase:${progress.currentPhaseIndex}`;
}

export const stageBucketKeyPattern = /^(not_started|in_progress|final|complete|phase:\d{1,2})$/;

function stageBuckets(release: InsightsReleaseInput): InsightsStageBucket[] {
  if (release.executionVersion === 0) {
    return [
      { key: "not_started", label: "尚未开始", count: 0 },
      { key: "in_progress", label: "已开始", count: 0 },
      { key: "complete", label: "已正式提交", count: 0 },
    ];
  }
  return [
    { key: "not_started", label: "尚未开始", count: 0 },
    ...release.phases.map((phase, index) => ({
      key: `phase:${index + 1}`,
      label: phase.name,
      count: 0,
    })),
    ...(release.submissionMode === "mixed"
      ? [{ key: "final", label: "整项终稿", count: 0 }]
      : []),
    { key: "complete", label: "全部完成", count: 0 },
  ];
}

function incrementBucket(
  buckets: InsightsStageBucket[],
  key: string,
): InsightsStageBucket[] {
  return buckets.map((bucket) =>
    bucket.key === key ? { ...bucket, count: bucket.count + 1 } : bucket,
  );
}

export function aggregateStageCard(
  release: InsightsReleaseInput,
): InsightsStageCard {
  const groupedIds = new Set(
    release.groups.flatMap((group) => group.memberIds),
  );
  const audiences: {
    submissions: InsightsReleaseInput["submissions"];
  }[] = [
    ...release.groups.map((group) => ({
      submissions: release.submissions.filter(
        (submission) => submission.groupId === group.id,
      ),
    })),
    ...release.currentMemberIds
      .filter((studentId) => !groupedIds.has(studentId))
      .map((studentId) => ({
        submissions: release.submissions.filter(
          (submission) => submission.studentId === studentId,
        ),
      })),
  ];

  let buckets = stageBuckets(release);
  for (const audience of audiences) {
    const progress = currentAudienceProgress({
      executionVersion: release.executionVersion,
      submissionMode: release.submissionMode,
      phaseCount: release.phases.length,
      submissions: audience.submissions,
    });
    buckets = incrementBucket(
      buckets,
      stageBucketKey(progress, release.executionVersion),
    );
  }

  return {
    releaseId: release.id,
    title: release.title,
    classroomName: release.classroomName,
    audienceCount: audiences.length,
    buckets,
  };
}

function compareOutcomes(
  before: InsightsOutcome,
  after: InsightsOutcome,
): "rose" | "unchanged" | "fell" {
  if (
    before.status === "INSUFFICIENT_EVIDENCE" &&
    after.status === "INSUFFICIENT_EVIDENCE"
  ) {
    return "unchanged";
  }
  if (before.status === "INSUFFICIENT_EVIDENCE") {
    return "rose";
  }
  if (after.status === "INSUFFICIENT_EVIDENCE") {
    return "fell";
  }
  const delta = LEVEL_RANK[after.level] - LEVEL_RANK[before.level];
  if (delta > 0) {
    return "rose";
  }
  if (delta < 0) {
    return "fell";
  }
  return "unchanged";
}

export function aggregateFeedbackImprovement(
  releases: readonly InsightsReleaseInput[],
): InsightsImprovement {
  let reviseCount = 0;
  let resubmittedCount = 0;
  let evaluationPairs = 0;
  let rose = 0;
  let unchanged = 0;
  let fell = 0;

  for (const release of releases) {
    for (const submission of release.submissions) {
      const ordered = [...submission.revisions].sort(
        (left, right) => left.revisionNumber - right.revisionNumber,
      );
      for (const revision of ordered) {
        if (revision.nextStep !== "REVISE") {
          continue;
        }
        reviseCount += 1;
        const later = ordered.filter(
          (candidate) => candidate.revisionNumber > revision.revisionNumber,
        );
        if (later.length === 0) {
          continue;
        }
        resubmittedCount += 1;
        const after = later.find((candidate) => candidate.outcomes !== null);
        if (!revision.outcomes || !after?.outcomes) {
          continue;
        }
        evaluationPairs += 1;
        for (const beforeOutcome of revision.outcomes) {
          const afterOutcome = after.outcomes.find(
            (outcome) =>
              outcome.dimensionIndex === beforeOutcome.dimensionIndex &&
              outcome.dimensionName === beforeOutcome.dimensionName,
          );
          if (!afterOutcome) {
            continue;
          }
          const movement = compareOutcomes(beforeOutcome, afterOutcome);
          if (movement === "rose") {
            rose += 1;
          } else if (movement === "fell") {
            fell += 1;
          } else {
            unchanged += 1;
          }
        }
      }
    }
  }

  return {
    reviseCount,
    resubmittedCount,
    evaluationPairs,
    rose,
    unchanged,
    fell,
  };
}

export function buildTeacherInsightsView(
  releases: readonly InsightsReleaseInput[],
  selectedReleaseId: string | null,
): TeacherInsightsView {
  const selected = selectedReleaseId
    ? releases.filter((release) => release.id === selectedReleaseId)
    : [...releases];
  return {
    selectedReleaseId,
    releaseOptions: releases.map((release) => ({
      id: release.id,
      title: release.title,
      classroomName: release.classroomName,
    })),
    rubric: selected.map(aggregateRubricCard),
    stages: selected.map(aggregateStageCard),
    improvement: aggregateFeedbackImprovement(selected),
  };
}
