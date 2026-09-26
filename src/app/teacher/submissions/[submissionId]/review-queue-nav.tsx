import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  reviewQueueQuery,
  reviewQueueStatusLabels,
  type ReviewQueueFilter,
  type ReviewQueuePosition,
} from "../../../../domain/review/review-queue";

const link =
  "inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-sm hover:bg-muted";
const disabled =
  "inline-flex h-8 items-center gap-1 rounded-lg border border-dashed px-2.5 text-sm text-muted-foreground/60";

/**
 * Previous / next within the teacher's filtered queue. Plain anchors, not
 * client links: a full navigation lets an unsaved form's beforeunload guard
 * speak up (D-069).
 */
export function ReviewQueueNav({
  releaseId,
  filter,
  position,
}: {
  releaseId: string;
  filter: ReviewQueueFilter;
  position: ReviewQueuePosition;
}) {
  const query = reviewQueueQuery(filter);
  const queueLabel = `${reviewQueueStatusLabels[filter.status]}${
    filter.phase !== null ? ` · 第 ${filter.phase} 阶段` : ""
  }${filter.dimension !== null ? ` · 维度 ${filter.dimension} 待改进` : ""}`;
  return (
    <nav
      aria-label="评阅队列"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2"
    >
      <span className="text-sm">
        {position.position !== null
          ? `${queueLabel} · 第 ${position.position}/${position.total} 份`
          : position.total > 0
            ? `这份不在「${queueLabel}」中 · 队列还有 ${position.total} 份`
            : `「${queueLabel}」已全部处理`}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {position.previousId ? (
          <a className={link} href={`/teacher/submissions/${position.previousId}${query}`}>
            <ChevronLeftIcon className="size-4" />
            上一份
          </a>
        ) : (
          <span aria-disabled="true" className={disabled}>
            <ChevronLeftIcon className="size-4" />
            上一份
          </span>
        )}
        {position.nextId ? (
          <a className={link} href={`/teacher/submissions/${position.nextId}${query}`}>
            下一份
            <ChevronRightIcon className="size-4" />
          </a>
        ) : (
          <span aria-disabled="true" className={disabled}>
            已是最后一份
          </span>
        )}
        <a className={link} href={`/teacher/releases/${releaseId}/submissions${query}`}>
          返回名册
        </a>
      </span>
    </nav>
  );
}
