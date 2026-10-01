import Link from "next/link";
import { ChevronRightIcon, SchoolIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "../../../_components/ui";
import type { DraftOriginSignals } from "../../../../server/queries/release-task-book-signals";

const stateCopy = {
  unchanged: null,
  changed: { label: "这一处你已改过", tone: "done" },
  removed: { label: "这一处已不在草稿里", tone: "closed" },
} as const;

/**
 * What happened in class the last time this task book was published (D-088).
 * Read live from the source release, so it follows new submissions and
 * evaluations there; it never changes the draft.
 */
export function OriginSignals({
  origin,
  usedByDiagnosis,
}: {
  origin: DraftOriginSignals;
  usedByDiagnosis: boolean;
}) {
  if (origin.signals.length === 0) {
    return null;
  }
  return (
    <Card id="origin-signals">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SchoolIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          上次发布的课堂信号
        </CardTitle>
        <CardDescription>
          {`来自「${origin.title}」在${origin.classroomName}的过程诊断。这些数据多半与任务书的写法有关，供修改时参考${
            usedByDiagnosis ? "；版本检查也会一并参考" : ""
          }。`}
        </CardDescription>
        <CardAction>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/teacher/insights?release=${origin.releaseId}`}>
              看那次的诊断
              <ChevronRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {origin.signals.map((signal, index) => {
            const state = stateCopy[signal.state];
            return (
              <li
                className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
                key={`${signal.target}-${signal.kind}-${index}`}
              >
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {signal.sourceLabel}
                  {state ? (
                    <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                  ) : null}
                </p>
                <p className="text-sm text-muted-foreground">{signal.text}</p>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
