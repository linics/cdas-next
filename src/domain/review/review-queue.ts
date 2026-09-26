/**
 * The teacher's review queue for one release (D-069). A queue is the roster
 * in its own stable order, narrowed by a whitelisted status and an optional
 * phase. Navigation is anchored on the current submission's place in the
 * full order, so saving feedback — which may drop the current item out of
 * "待反馈" — never shifts which item comes next.
 */
export const reviewQueueStatuses = [
  { code: "all", label: "全部" },
  { code: "feedback", label: "待反馈" },
  { code: "evaluation", label: "待评价" },
  { code: "resubmit", label: "待重交" },
] as const;

export type ReviewQueueStatus = (typeof reviewQueueStatuses)[number]["code"];

export const reviewQueueStatusLabels = Object.fromEntries(
  reviewQueueStatuses.map((item) => [item.code, item.label]),
) as Record<ReviewQueueStatus, string>;

export type ReviewQueueFilter = Readonly<{
  status: ReviewQueueStatus;
  phase: number | null;
  /**
   * A rubric dimension (1-based) from the insights drill-down (D-070): only
   * submissions whose current evaluation puts it at 待改进 or 证据不足.
   */
  dimension: number | null;
}>;

export const defaultReviewQueueFilter: ReviewQueueFilter = {
  status: "all",
  phase: null,
  dimension: null,
};

export type ReviewQueueItem = Readonly<{
  submissionId: string;
  phaseIndex: number;
  hasFeedback: boolean;
  hasEvaluation: boolean;
  awaitingResubmission: boolean;
  lowDimensionIndexes: readonly number[];
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Only known values survive; anything else falls back to the default. The
 * filter is navigation context, never authorization.
 */
export function parseReviewQueueFilter(
  params: Readonly<Record<string, string | string[] | undefined>>,
): ReviewQueueFilter {
  const status = first(params.queue);
  const phaseText = first(params.phase);
  const phase = phaseText && /^\d{1,2}$/.test(phaseText) ? Number(phaseText) : null;
  const dimensionText = first(params.dim);
  const dimension =
    dimensionText && /^[1-8]$/.test(dimensionText) ? Number(dimensionText) : null;
  return {
    status: reviewQueueStatuses.some((item) => item.code === status)
      ? (status as ReviewQueueStatus)
      : "all",
    phase,
    dimension,
  };
}

export function reviewQueueQuery(filter: ReviewQueueFilter): string {
  const params = new URLSearchParams();
  if (filter.status !== "all") params.set("queue", filter.status);
  if (filter.phase !== null) params.set("phase", String(filter.phase));
  if (filter.dimension !== null) params.set("dim", String(filter.dimension));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function matchesReviewQueue(
  item: ReviewQueueItem,
  filter: ReviewQueueFilter,
  rubricAvailable: boolean,
): boolean {
  if (filter.phase !== null && item.phaseIndex !== filter.phase) return false;
  if (
    filter.dimension !== null &&
    !item.lowDimensionIndexes.includes(filter.dimension)
  ) {
    return false;
  }
  switch (filter.status) {
    case "all":
      return true;
    case "feedback":
      return !item.hasFeedback;
    case "evaluation":
      return rubricAvailable && !item.hasEvaluation;
    case "resubmit":
      return item.awaitingResubmission;
  }
}

export type ReviewQueuePosition = Readonly<{
  total: number;
  /** 1-based place among matching items, or null if the current one no longer matches. */
  position: number | null;
  previousId: string | null;
  nextId: string | null;
}>;

/**
 * Neighbours of `currentId` among the matching items of `ordered`. If the
 * current item is not in the roster at all, there are no neighbours.
 */
export function reviewQueuePosition(
  ordered: readonly ReviewQueueItem[],
  currentId: string,
  filter: ReviewQueueFilter,
  rubricAvailable: boolean,
): ReviewQueuePosition {
  const matches = (item: ReviewQueueItem) =>
    matchesReviewQueue(item, filter, rubricAvailable);
  const total = ordered.filter(matches).length;
  const index = ordered.findIndex((item) => item.submissionId === currentId);
  if (index === -1) {
    return { total, position: null, previousId: null, nextId: null };
  }
  const before = ordered.slice(0, index).filter(matches);
  const after = ordered.slice(index + 1).filter(matches);
  const current = ordered[index]!;
  return {
    total,
    position: matches(current) ? before.length + 1 : null,
    previousId: before.at(-1)?.submissionId ?? null,
    nextId: after[0]?.submissionId ?? null,
  };
}
