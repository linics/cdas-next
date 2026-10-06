import type { TeacherEvaluationLevel } from "../evaluation/teacher-evaluation-policy";
import {
  teacherFeedbackSupportLevelLabels,
  teacherFeedbackSupportLevels,
  type TeacherFeedbackSupportLevel,
} from "../feedback/teacher-feedback-policy";
import {
  aggregateRubricCard,
  aggregateStageCard,
  compareOutcomes,
  currentAudienceProgress,
  evaluationGoalScope,
  isDimensionRelevantToPhase,
  stageBucketKey,
  type InsightsOutcome,
  type InsightsReleaseInput,
  type InsightsRubricDimension,
  type InsightsSubmissionInput,
} from "./teacher-insights";

/**
 * The per-release diagnosis the first-party page shows (D-084): who sits
 * where, how each evaluated submission fared per dimension, and a short list
 * of things worth a look. Unlike the aggregate the Agent reads (D-051), this
 * names students and groups, so it is only ever built for the UI.
 */

/** Days without any saved change before an unfinished audience counts as stalled. */
export const STALL_DAYS = 5;
/** Below this many relevant evaluations a dimension is never called weak. */
export const WEAK_MIN_SAMPLE = 3;
/** Days before the deadline at which "not started" becomes urgent. */
export const DUE_SOON_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DiagnosisSubmissionInput = InsightsSubmissionInput &
  Readonly<{
    /** Whether this is the submission that takes the rubric (D-077). */
    final: boolean;
    /** Latest saved change to the student's working copy, if one exists. */
    workingCopyUpdatedAt: string | null;
    currentRevision: Readonly<{
      submittedAt: string;
      isLate: boolean;
      hasFeedback: boolean;
      /** Evidence items (1-based, within the phase) the student ticked. */
      completedEvidenceIndexes: readonly number[];
      /** The scaffold tier on the current feedback, when one was chosen (D-034). */
      supportLevel: TeacherFeedbackSupportLevel | null;
      feedbackConfirmedAt: string | null;
    }> | null;
  }>;

export type DiagnosisReleaseInput = Omit<
  InsightsReleaseInput,
  "groups" | "submissions" | "currentMemberIds" | "phases"
> &
  Readonly<{
    phases: readonly {
      name: string;
      learningGoalIds?: readonly string[];
      evidence: readonly { description: string; typeLabel: string }[];
    }[];
    status: "ACTIVE" | "CLOSED" | "ARCHIVED";
    dueAt: string | null;
    members: readonly { id: string; name: string }[];
    groups: readonly { id: string; name: string; memberIds: readonly string[] }[];
    submissions: readonly DiagnosisSubmissionInput[];
  }>;

export type DiagnosisAudience = Readonly<{
  key: string;
  kind: "student" | "group";
  name: string;
  stageKey: string;
  /** Whole days since the last saved change; null when nothing was started. */
  idleDays: number | null;
  stalled: boolean;
  /** The submission a teacher would open first for this audience, if any. */
  latestSubmissionId: string | null;
}>;

export type DiagnosisLane = Readonly<{
  key: string;
  label: string;
  audiences: readonly DiagnosisAudience[];
}>;

export type DiagnosisCell =
  | TeacherEvaluationLevel
  | "insufficient"
  /** The dimension does not speak to this submission's phase (D-076). */
  | "irrelevant"
  /** No confirmed evaluation yet. */
  | "none";

export type DiagnosisMatrixRow = Readonly<{
  submissionId: string;
  audienceName: string;
  /** Named only for legacy per-phase evaluations; null for the final submission. */
  phaseLabel: string | null;
  evaluated: boolean;
  cells: readonly DiagnosisCell[];
}>;

export type DiagnosisMatrix = Readonly<{
  status: "no_rubric" | "no_evaluations" | "ready";
  sampleCount: number;
  dimensions: readonly (InsightsRubricDimension & { lowCount: number })[];
  rows: readonly DiagnosisMatrixRow[];
}>;

export type DiagnosisAlert = Readonly<{
  kind:
    | "not_started"
    | "stalled"
    | "awaiting_feedback"
    | "weak_dimension"
    | "evidence_gap"
    | "awaiting_resubmission";
  /** urgent = act now; attention = worth a look; note = for awareness. */
  tone: "urgent" | "attention" | "note";
  text: string;
  basis: string;
  /**
   * `roster` appends `query` to the release's roster URL; `page` is an anchor
   * on the diagnosis page itself.
   */
  action: Readonly<{
    label: string;
    target: "roster" | "page";
    query: string;
    primary: boolean;
  }>;
}>;

export type DiagnosisSubmissionRef = Readonly<{
  submissionId: string;
  audienceName: string;
  /** Null for the final submission; the phase name otherwise. */
  phaseLabel: string | null;
}>;

export type DiagnosisEvidencePhase = Readonly<{
  phaseIndex: number;
  phaseName: string;
  /** Current formal revisions of this phase. */
  submittedCount: number;
  items: readonly Readonly<{
    evidenceIndex: number;
    description: string;
    typeLabel: string;
    doneCount: number;
    missing: readonly DiagnosisSubmissionRef[];
  }>[];
}>;

export type DiagnosisMove = Readonly<{
  dimensionName: string;
  before: DiagnosisCell;
  after: DiagnosisCell;
  movement: "rose" | "unchanged" | "fell";
}>;

export type DiagnosisResubmission = Readonly<{
  reviseCount: number;
  resubmittedCount: number;
  /** Asked to revise and nothing formal has come back yet. */
  awaiting: readonly DiagnosisSubmissionRef[];
  /** Evaluated both before and after a requested revision. */
  pairs: readonly (DiagnosisSubmissionRef & { moves: readonly DiagnosisMove[] })[];
  rose: number;
  unchanged: number;
  fell: number;
}>;

export type DiagnosisSupport = Readonly<{
  tiers: readonly Readonly<{
    level: TeacherFeedbackSupportLevel;
    label: string;
    audiences: readonly { name: string; submissionId: string }[];
  }>[];
}>;

export type ReleaseDiagnosis = Readonly<{
  releaseId: string;
  title: string;
  classroomName: string;
  status: "ACTIVE" | "CLOSED" | "ARCHIVED";
  dueAt: string | null;
  /** 人 / 组 / 个学生或小组 — whatever this release's audiences actually are. */
  unit: string;
  audienceCount: number;
  completeCount: number;
  lanes: readonly DiagnosisLane[];
  matrix: DiagnosisMatrix;
  evidence: readonly DiagnosisEvidencePhase[];
  resubmission: DiagnosisResubmission;
  /** Null until some current feedback carries a scaffold tier. */
  support: DiagnosisSupport | null;
  alerts: readonly DiagnosisAlert[];
}>;

function wholeDaysBetween(earlier: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(earlier)) / DAY_MS));
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, "zh-Hans-CN");
}

function latestActivity(
  submissions: readonly DiagnosisSubmissionInput[],
): string | null {
  const instants = submissions.flatMap((submission) => [
    ...(submission.workingCopyUpdatedAt ? [submission.workingCopyUpdatedAt] : []),
    ...(submission.currentRevision ? [submission.currentRevision.submittedAt] : []),
  ]);
  if (instants.length === 0) return null;
  return instants.reduce((latest, instant) =>
    Date.parse(instant) > Date.parse(latest) ? instant : latest,
  );
}

/** The whole-task submission first, then the furthest phase. */
function reviewOrder(submission: { phaseIndex: number }): number {
  return submission.phaseIndex === 0 ? Number.MAX_SAFE_INTEGER : submission.phaseIndex;
}

function audienceSubmissions(release: DiagnosisReleaseInput) {
  const groupedIds = new Set(release.groups.flatMap((group) => group.memberIds));
  return [
    ...release.groups.map((group) => ({
      key: `group:${group.id}`,
      kind: "group" as const,
      name: group.name,
      submissions: release.submissions.filter(
        (submission) => submission.groupId === group.id,
      ),
    })),
    ...release.members
      .filter((member) => !groupedIds.has(member.id))
      .map((member) => ({
        key: `student:${member.id}`,
        kind: "student" as const,
        name: member.name,
        submissions: release.submissions.filter(
          (submission) => submission.studentId === member.id,
        ),
      })),
  ];
}

function buildAudiences(
  release: DiagnosisReleaseInput,
  now: Date,
): DiagnosisAudience[] {
  const raw = audienceSubmissions(release);

  return raw
    .map((audience) => {
      const progress = currentAudienceProgress({
        executionVersion: release.executionVersion,
        submissionMode: release.submissionMode,
        phaseCount: release.phases.length,
        submissions: audience.submissions,
      });
      const lastActivity = latestActivity(audience.submissions);
      const idleDays = lastActivity ? wholeDaysBetween(lastActivity, now) : null;
      const submitted = audience.submissions
        .filter((submission) => submission.latestRevisionNumber > 0)
        .sort((left, right) => reviewOrder(right) - reviewOrder(left));
      return {
        key: audience.key,
        kind: audience.kind,
        name: audience.name,
        stageKey: stageBucketKey(progress, release.executionVersion),
        idleDays,
        // Stalling is about students who started and then went quiet while the
        // release is still open; a finished or untouched audience is not stalled.
        stalled:
          release.status === "ACTIVE" &&
          progress.started &&
          !progress.complete &&
          idleDays !== null &&
          idleDays >= STALL_DAYS,
        latestSubmissionId: submitted[0]?.id ?? null,
      };
    })
    .sort(byName);
}

function audienceNameFor(
  release: DiagnosisReleaseInput,
  submission: DiagnosisSubmissionInput,
): string {
  if (submission.groupId) {
    return (
      release.groups.find((group) => group.id === submission.groupId)?.name ??
      "已解散的小组"
    );
  }
  return (
    release.members.find((member) => member.id === submission.studentId)?.name ??
    "已不在班级的学生"
  );
}

function phaseLabelFor(
  release: DiagnosisReleaseInput,
  submission: DiagnosisSubmissionInput,
): string | null {
  if (submission.final || submission.phaseIndex === 0) return null;
  return (
    release.phases[submission.phaseIndex - 1]?.name ??
    `第 ${submission.phaseIndex} 阶段`
  );
}

function refFor(
  release: DiagnosisReleaseInput,
  submission: DiagnosisSubmissionInput,
): DiagnosisSubmissionRef {
  return {
    submissionId: submission.id,
    audienceName: audienceNameFor(release, submission),
    phaseLabel: phaseLabelFor(release, submission),
  };
}

function byAudienceName(
  left: { audienceName: string },
  right: { audienceName: string },
): number {
  return left.audienceName.localeCompare(right.audienceName, "zh-Hans-CN");
}

function cellOf(outcome: InsightsOutcome): DiagnosisCell {
  return outcome.status === "INSUFFICIENT_EVIDENCE" ? "insufficient" : outcome.level;
}

export function isMostlyLow(sampleCount: number, lowCount: number): boolean {
  return sampleCount >= WEAK_MIN_SAMPLE && lowCount * 2 >= sampleCount;
}

function buildMatrix(release: DiagnosisReleaseInput): DiagnosisMatrix {
  const card = aggregateRubricCard(toInsightsInput(release));
  const dimensions = release.rubricDimensions ?? [];

  const rows = release.submissions
    .flatMap((submission): (DiagnosisMatrixRow & { order: number })[] => {
      if (submission.latestRevisionNumber === 0) return [];
      const outcomes =
        submission.revisions.find(
          (revision) => revision.revisionNumber === submission.latestRevisionNumber,
        )?.outcomes ?? null;
      const final = submission.final;
      // Unevaluated phase submissions never take a rubric, so they are not
      // rows; an unevaluated final submission is, because it is waiting.
      if (!outcomes && !final) return [];
      const phaseGoalIds = evaluationGoalScope(release, submission.phaseIndex);
      return [
        {
          submissionId: submission.id,
          audienceName: audienceNameFor(release, submission),
          phaseLabel: phaseLabelFor(release, submission),
          evaluated: outcomes !== null,
          order: reviewOrder(submission),
          cells: dimensions.map((dimension, index): DiagnosisCell => {
            if (!outcomes) return "none";
            if (!isDimensionRelevantToPhase(phaseGoalIds, dimension.learningGoalIds)) {
              return "irrelevant";
            }
            const outcome = outcomes.find(
              (item) =>
                item.dimensionIndex === index + 1 &&
                item.dimensionName === dimension.name,
            );
            if (!outcome) return "none";
            return outcome.status === "INSUFFICIENT_EVIDENCE"
              ? "insufficient"
              : outcome.level;
          }),
        },
      ];
    })
    // Roster order, never by score: the matrix is not a ranking.
    .sort(
      (left, right) =>
        left.audienceName.localeCompare(right.audienceName, "zh-Hans-CN") ||
        left.order - right.order,
    )
    .map((row) => ({
      submissionId: row.submissionId,
      audienceName: row.audienceName,
      phaseLabel: row.phaseLabel,
      evaluated: row.evaluated,
      cells: row.cells,
    }));

  return {
    status: card.status,
    sampleCount: card.sampleCount,
    dimensions: card.dimensions.map((dimension) => {
      const lowCount = dimension.improve + dimension.insufficient;
      return {
        ...dimension,
        lowCount,
        // "Weak" here means most of the relevant evaluations sit in the low
        // band, and never on one or two evaluations (D-084). The Agent's
        // aggregate keeps its own "highest count" flag (D-051).
        weak: isMostlyLow(dimension.sampleCount, lowCount),
      };
    }),
    rows,
  };
}

function toInsightsInput(release: DiagnosisReleaseInput): InsightsReleaseInput {
  return {
    id: release.id,
    title: release.title,
    classroomName: release.classroomName,
    executionVersion: release.executionVersion,
    submissionMode: release.submissionMode,
    phases: release.phases,
    rubricDimensions: release.rubricDimensions,
    groups: release.groups,
    currentMemberIds: release.members.map((member) => member.id),
    submissions: release.submissions,
  };
}

/**
 * Which evidence items students ticked on the current formal revision of each
 * phase. An item most submissions skip is usually a task-book problem (the
 * requirement is unclear or too heavy), not a student one.
 */
function buildEvidence(release: DiagnosisReleaseInput): DiagnosisEvidencePhase[] {
  if (release.executionVersion !== 1) return [];
  return release.phases.flatMap((phase, index) => {
    const submitted = release.submissions.filter(
      (submission) =>
        submission.phaseIndex === index + 1 && submission.currentRevision !== null,
    );
    if (submitted.length === 0 || phase.evidence.length === 0) return [];
    return [
      {
        phaseIndex: index + 1,
        phaseName: phase.name,
        submittedCount: submitted.length,
        items: phase.evidence.map((evidence, evidenceIndex) => {
          const missing = submitted
            .filter(
              (submission) =>
                !submission.currentRevision!.completedEvidenceIndexes.includes(
                  evidenceIndex + 1,
                ),
            )
            .map((submission) => ({
              submissionId: submission.id,
              audienceName: audienceNameFor(release, submission),
              phaseLabel: null,
            }))
            .sort(byAudienceName);
          return {
            evidenceIndex: evidenceIndex + 1,
            description: evidence.description,
            typeLabel: evidence.typeLabel,
            doneCount: submitted.length - missing.length,
            missing,
          };
        }),
      },
    ];
  });
}

/**
 * What happened after "revise and resubmit". Pairing follows the aggregate
 * (each REVISE revision against the first later evaluated one), but only
 * dimensions relevant to the submission's phase are compared (D-076), so an
 * irrelevant "证据不足 → 证据不足" never shows up as "no change".
 */
function buildResubmission(release: DiagnosisReleaseInput): DiagnosisResubmission {
  const dimensions = release.rubricDimensions ?? [];
  const awaiting: DiagnosisSubmissionRef[] = [];
  const pairs: (DiagnosisSubmissionRef & { moves: DiagnosisMove[] })[] = [];
  let reviseCount = 0;
  let resubmittedCount = 0;

  for (const submission of release.submissions) {
    const ordered = [...submission.revisions].sort(
      (left, right) => left.revisionNumber - right.revisionNumber,
    );
    const phaseGoalIds = evaluationGoalScope(release, submission.phaseIndex);
    for (const revision of ordered) {
      if (revision.nextStep !== "REVISE") continue;
      reviseCount += 1;
      const later = ordered.filter(
        (candidate) => candidate.revisionNumber > revision.revisionNumber,
      );
      if (later.length === 0) {
        awaiting.push(refFor(release, submission));
        continue;
      }
      resubmittedCount += 1;
      const before = revision.outcomes;
      const after = later.find((candidate) => candidate.outcomes !== null)?.outcomes;
      if (!before || !after) continue;
      const moves = dimensions.flatMap((dimension, index): DiagnosisMove[] => {
        if (!isDimensionRelevantToPhase(phaseGoalIds, dimension.learningGoalIds)) {
          return [];
        }
        const match = (outcome: InsightsOutcome) =>
          outcome.dimensionIndex === index + 1 &&
          outcome.dimensionName === dimension.name;
        const beforeOutcome = before.find(match);
        const afterOutcome = after.find(match);
        if (!beforeOutcome || !afterOutcome) return [];
        return [
          {
            dimensionName: dimension.name,
            before: cellOf(beforeOutcome),
            after: cellOf(afterOutcome),
            movement: compareOutcomes(beforeOutcome, afterOutcome),
          },
        ];
      });
      pairs.push({ ...refFor(release, submission), moves });
    }
  }

  const moves = pairs.flatMap((pair) => pair.moves);
  const count = (movement: DiagnosisMove["movement"]) =>
    moves.filter((move) => move.movement === movement).length;
  return {
    reviseCount,
    resubmittedCount,
    awaiting: awaiting.sort(byAudienceName),
    pairs: pairs.sort(byAudienceName),
    rose: count("rose"),
    unchanged: count("unchanged"),
    fell: count("fell"),
  };
}

/**
 * The scaffold tier the teacher last chose for each audience (D-034). It is
 * the teacher's own record of how much help to give next, not a judgment of
 * ability, and students never see it (D-078).
 */
function buildSupport(release: DiagnosisReleaseInput): DiagnosisSupport | null {
  const latest = audienceSubmissions(release).flatMap((audience) => {
    const tiered = audience.submissions
      .flatMap((submission) =>
        submission.currentRevision?.supportLevel &&
        submission.currentRevision.feedbackConfirmedAt
          ? [
              {
                submissionId: submission.id,
                level: submission.currentRevision.supportLevel,
                confirmedAt: Date.parse(submission.currentRevision.feedbackConfirmedAt),
              },
            ]
          : [],
      )
      .sort((left, right) => right.confirmedAt - left.confirmedAt)[0];
    return tiered ? [{ name: audience.name, ...tiered }] : [];
  });
  if (latest.length === 0) return null;
  return {
    tiers: teacherFeedbackSupportLevels.map((level) => ({
      level,
      label: teacherFeedbackSupportLevelLabels[level],
      audiences: latest
        .filter((item) => item.level === level)
        .map((item) => ({ name: item.name, submissionId: item.submissionId }))
        .sort(byName),
    })),
  };
}

function shorten(text: string, max = 24): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}…`;
}

function unitFor(audiences: readonly DiagnosisAudience[]): string {
  const hasGroups = audiences.some((audience) => audience.kind === "group");
  const hasStudents = audiences.some((audience) => audience.kind === "student");
  if (hasGroups && hasStudents) return "个学生或小组";
  return hasGroups ? "组" : "人";
}

function nameList(audiences: readonly DiagnosisAudience[]): string {
  const names = audiences.map((audience) => audience.name);
  return names.length <= 4
    ? names.join("、")
    : `${names.slice(0, 4).join("、")} 等 ${names.length} ${
        audiences.every((audience) => audience.kind === "group") ? "组" : "人"
      }`;
}

function dueBasis(
  dueAt: string | null,
  now: Date,
): { text: string | null; soon: boolean } {
  if (!dueAt) return { text: null, soon: false };
  const remaining = Date.parse(dueAt) - now.getTime();
  if (remaining <= 0) return { text: "已过截止时间", soon: true };
  const days = Math.floor(remaining / DAY_MS);
  return {
    text: days === 0 ? "今天截止" : `距截止还有 ${days} 天`,
    soon: days <= DUE_SOON_DAYS,
  };
}

function basis(...parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(" · ");
}

function buildAlerts(
  release: DiagnosisReleaseInput,
  lanes: readonly DiagnosisLane[],
  matrix: DiagnosisMatrix,
  evidence: readonly DiagnosisEvidencePhase[],
  resubmission: DiagnosisResubmission,
  unit: string,
  now: Date,
): DiagnosisAlert[] {
  const alerts: DiagnosisAlert[] = [];
  const open = release.status === "ACTIVE";
  const due = dueBasis(release.dueAt, now);

  const notStarted = lanes.find((lane) => lane.key === "not_started")?.audiences ?? [];
  if (open && notStarted.length > 0) {
    alerts.push({
      kind: "not_started",
      tone: due.soon ? "urgent" : "attention",
      text: `${notStarted.length} ${unit}还没开始`,
      basis: basis(nameList(notStarted), due.text),
      action: {
        label: "查看是谁",
        target: "roster",
        query: "?stage=not_started#progress",
        primary: false,
      },
    });
  }

  for (const lane of lanes) {
    const stalled = lane.audiences.filter((audience) => audience.stalled);
    if (stalled.length === 0) continue;
    const longest = Math.max(...stalled.map((audience) => audience.idleDays ?? 0));
    alerts.push({
      kind: "stalled",
      tone: due.soon ? "urgent" : "attention",
      text: `「${lane.label}」有 ${stalled.length} ${unit}超过 ${STALL_DAYS} 天没有改动`,
      basis: basis(nameList(stalled), `最久 ${longest} 天`, due.text),
      action: {
        label: "查看是谁",
        target: "roster",
        query: `?stage=${encodeURIComponent(lane.key)}#progress`,
        primary: false,
      },
    });
  }

  const waiting = release.submissions.flatMap((submission) =>
    submission.currentRevision && !submission.currentRevision.hasFeedback
      ? [submission.currentRevision.submittedAt]
      : [],
  );
  if (waiting.length > 0) {
    const oldest = waiting.reduce((earliest, instant) =>
      Date.parse(instant) < Date.parse(earliest) ? instant : earliest,
    );
    const waitedDays = wholeDaysBetween(oldest, now);
    alerts.push({
      kind: "awaiting_feedback",
      tone: waitedDays >= STALL_DAYS ? "urgent" : "attention",
      text: `${waiting.length} 份提交在等你的反馈`,
      basis:
        waitedDays === 0
          ? "最早的一份是今天提交的"
          : `最早的一份已经等了 ${waitedDays} 天`,
      action: {
        label: "开始评阅",
        target: "roster",
        query: "?queue=feedback",
        primary: true,
      },
    });
  }

  for (const dimension of matrix.dimensions) {
    if (!dimension.weak) continue;
    alerts.push({
      kind: "weak_dimension",
      tone: "attention",
      text: `「${dimension.dimensionName}」${dimension.sampleCount} 份相关评价中 ${dimension.lowCount} 份需改进或证据不足`,
      basis:
        dimension.insufficient > dimension.improve
          ? "多数是证据不足：可能是证据要求没让学生把这一点交出来"
          : "一个维度多数人偏弱，多半与任务或讲解有关，而不是个别学生的问题",
      action: {
        label: `看这 ${dimension.lowCount} 份`,
        target: "roster",
        query: `?dim=${dimension.dimensionIndex}`,
        primary: false,
      },
    });
  }

  for (const phase of evidence) {
    for (const item of phase.items) {
      if (!isMostlyLow(phase.submittedCount, item.missing.length)) continue;
      alerts.push({
        kind: "evidence_gap",
        tone: "attention",
        text: `「${phase.phaseName}」的「${shorten(item.description)}」${phase.submittedCount} 份中 ${item.missing.length} 份没勾选`,
        basis: "多数人没交这一项，可能是任务书没讲清要交什么，或这一项要求过重",
        action: {
          label: "看是哪几份",
          target: "page",
          query: "#evidence",
          primary: false,
        },
      });
    }
  }

  if (open && resubmission.awaiting.length > 0) {
    alerts.push({
      kind: "awaiting_resubmission",
      tone: "note",
      text: `要求重交的 ${resubmission.reviseCount} 份里 ${resubmission.awaiting.length} 份还没重交`,
      basis: basis(
        resubmission.awaiting.map((item) => item.audienceName).join("、"),
        due.text,
      ),
      action: {
        label: "查看",
        target: "roster",
        query: "?queue=resubmit",
        primary: false,
      },
    });
  }

  const rank = { urgent: 0, attention: 1, note: 2 } as const;
  return alerts
    .map((alert, index) => ({ alert, index }))
    .sort(
      (left, right) =>
        rank[left.alert.tone] - rank[right.alert.tone] || left.index - right.index,
    )
    .map(({ alert }) => alert);
}

export function buildReleaseDiagnosis(
  release: DiagnosisReleaseInput,
  now: Date,
): ReleaseDiagnosis {
  const audiences = buildAudiences(release, now);
  // Reuse the card's bucket list so lane labels and order stay identical to
  // what the Agent's aggregate reports (D-051).
  const lanes = aggregateStageCard(toInsightsInput(release)).buckets.map(
    (bucket) => ({
      key: bucket.key,
      label: bucket.label,
      audiences: audiences.filter((audience) => audience.stageKey === bucket.key),
    }),
  );
  const matrix = buildMatrix(release);
  const evidence = buildEvidence(release);
  const resubmission = buildResubmission(release);
  const unit = unitFor(audiences);

  return {
    releaseId: release.id,
    title: release.title,
    classroomName: release.classroomName,
    status: release.status,
    dueAt: release.dueAt,
    unit,
    audienceCount: audiences.length,
    completeCount: audiences.filter((audience) => audience.stageKey === "complete")
      .length,
    lanes,
    matrix,
    evidence,
    resubmission,
    support: buildSupport(release),
    alerts: buildAlerts(release, lanes, matrix, evidence, resubmission, unit, now),
  };
}
