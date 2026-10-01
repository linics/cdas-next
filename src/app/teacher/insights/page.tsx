import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  ArrowRightIcon,
  BellRingIcon,
  ChevronRightIcon,
  FootprintsIcon,
  Grid3x3Icon,
  LifeBuoyIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  NotebookPenIcon,
  RepeatIcon,
} from "lucide-react";
import { z, ZodError } from "zod";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  WEAK_MIN_SAMPLE,
  type DiagnosisAlert,
  type DiagnosisAudience,
  type DiagnosisCell,
  type ReleaseDiagnosis,
} from "../../../domain/insights/release-diagnosis";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import { TeacherActivityQueryError } from "../../../server/queries/teacher-activity-workspace";
import {
  getTeacherInsights,
  type TeacherInsightsDashboard,
} from "../../../server/queries/teacher-insights";
import { getTeacherReleaseDiagnosis } from "../../../server/queries/teacher-release-diagnosis";
import {
  getReleaseAnswerSummaries,
  type ReleaseAnswerSummaryPhase,
} from "../../../server/queries/release-answer-summaries";
import {
  getReleaseTaskBookSignals,
  type ReleaseTaskBookSignals,
} from "../../../server/queries/release-task-book-signals";
import { isActivityAssistantEnabled } from "../../../server/assistant/assistant-config";
import { answerThemeKindLabels } from "../../../domain/insights/answer-themes";
import { AnswerSummaryTrigger } from "./answer-summary-trigger";
import { LocalizedDateTime } from "../../_components/localized-date-time";
import { PageHeader } from "../../_components/page-header";
import { revealChildren } from "../../_components/reveal";
import { EmptyState, StatusBadge, type StatusTone } from "../../_components/ui";
import { WorkspaceRoleGate } from "../../_components/workspace-shell";
import {
  TeacherAccessGate,
  TeacherPage,
  teacherHomeCrumb,
} from "../_components/teacher-shell";

type InsightsSearchParams = Promise<{
  release?: string | string[];
}>;

const releaseStatus = {
  ACTIVE: { label: "开放中", tone: "neutral" },
  CLOSED: { label: "已关闭", tone: "closed" },
  ARCHIVED: { label: "已封存", tone: "closed" },
} as const satisfies Record<string, { label: string; tone: StatusTone }>;

// 档位是一条从强到弱的刻度：优秀主色实底、良好主色浅底、合格灰、需改进珊瑚
//（与「需修改」同色）；证据不足只留描边。与本阶段无关的维度画斜纹，未评画虚线。
const cellStyle: Record<DiagnosisCell, { label: string; className: string }> = {
  excellent: { label: "优秀", className: "bg-primary text-primary-foreground" },
  good: { label: "良好", className: "bg-accent text-accent-foreground" },
  pass: {
    label: "合格",
    className: "bg-status-closed text-status-closed-foreground",
  },
  improve: {
    label: "需改进",
    className: "bg-status-resubmit text-status-resubmit-foreground",
  },
  insufficient: {
    label: "证据不足",
    className: "border border-border bg-background text-muted-foreground",
  },
  irrelevant: {
    label: "与该阶段无关",
    className:
      "bg-[repeating-linear-gradient(135deg,var(--border)_0_2px,transparent_2px_6px)]",
  },
  none: { label: "未评", className: "border border-dashed border-border" },
};

const alertDot: Record<DiagnosisAlert["tone"], string> = {
  urgent: "bg-status-resubmit-foreground",
  attention: "bg-status-pending-foreground",
  note: "bg-status-closed-foreground",
};

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function rosterHref(releaseId: string, query = ""): string {
  return `/teacher/releases/${releaseId}/submissions${query}`;
}

function countWord(unit: string): string {
  return unit === "个学生或小组" ? "个" : unit;
}

function ReleaseTabs({
  options,
  selectedId,
}: {
  options: TeacherInsightsDashboard["releaseOptions"];
  selectedId: string | null;
}) {
  return (
    <nav aria-label="选择活动" className="-m-1.5 overflow-x-auto p-1.5">
      <ul className="flex gap-3">
        {options.map((option) => {
          const selected = option.id === selectedId;
          const status = releaseStatus[option.status];
          return (
            <li className="shrink-0" key={option.id}>
              <Link
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "glass flex w-56 flex-col gap-1 rounded-2xl p-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected
                    ? "ring-2 ring-primary"
                    : "opacity-80 hover:opacity-100",
                )}
                href={`/teacher/insights?release=${option.id}`}
              >
                <span className={cn("truncate", selected && "font-semibold text-primary")}>
                  {option.title}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {option.classroomName} · {status.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof BellRingIcon;
  children: ReactNode;
}) {
  return (
    <CardTitle className="flex items-center gap-2">
      <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      {children}
    </CardTitle>
  );
}

function AlertsCard({ diagnosis }: { diagnosis: ReleaseDiagnosis }) {
  const word = countWord(diagnosis.unit);
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={BellRingIcon}>此刻值得看的</SectionTitle>
        <CardDescription>
          {`${diagnosis.audienceCount} ${diagnosis.unit}中 ${diagnosis.completeCount} ${word}已全部完成`}
          {diagnosis.dueAt ? (
            <>
              {" · "}
              <LocalizedDateTime dateTime={diagnosis.dueAt} /> 截止
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {diagnosis.alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            目前没有需要特别留意的地方。
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {diagnosis.alerts.map((alert) => (
              <li
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                key={`${alert.kind}-${alert.text}`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={cn("mt-2 size-2 shrink-0 rounded-full", alertDot[alert.tone])}
                  />
                  <div className="min-w-0">
                    <p className="font-medium">{alert.text}</p>
                    <p className="type-caption text-muted-foreground">{alert.basis}</p>
                  </div>
                </div>
                <Button
                  asChild
                  className="ml-5 shrink-0 self-start sm:ml-0 sm:self-auto"
                  size="sm"
                  variant={alert.action.primary ? "default" : "outline"}
                >
                  <Link
                    href={
                      alert.action.target === "page"
                        ? alert.action.query
                        : rosterHref(diagnosis.releaseId, alert.action.query)
                    }
                  >
                    {alert.action.label}
                    <ChevronRightIcon />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AudienceChip({
  audience,
  laneKey,
}: {
  audience: DiagnosisAudience;
  laneKey: string;
}) {
  const tone = audience.stalled
    ? "bg-status-resubmit text-status-resubmit-foreground"
    : laneKey === "complete"
      ? "bg-status-done text-status-done-foreground"
      : laneKey === "not_started"
        ? "bg-status-closed text-status-closed-foreground"
        : "bg-primary/12 text-primary";
  const chip = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          tone,
        )}
      >
        {Array.from(audience.name)[0]}
      </span>
      <span className="truncate">{audience.name}</span>
      {audience.stalled ? (
        <span className="shrink-0 text-xs text-status-resubmit-foreground tabular-nums">
          {audience.idleDays} 天没动
        </span>
      ) : null}
    </>
  );
  const className =
    "flex max-w-48 items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-sm ring-1 ring-foreground/8";
  return audience.latestSubmissionId ? (
    <Link
      className={cn(
        className,
        "transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
      href={`/teacher/submissions/${audience.latestSubmissionId}`}
    >
      {chip}
    </Link>
  ) : (
    <span className={className}>{chip}</span>
  );
}

function LanesCard({ diagnosis }: { diagnosis: ReleaseDiagnosis }) {
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={FootprintsIcon}>全班走到哪了</SectionTitle>
        <CardDescription>
          小组按组、个人按人计；要求重交不会退回阶段。点名字打开最近一份提交。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {diagnosis.audienceCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            当前班级暂无可统计的学生或小组。
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {diagnosis.lanes.map((lane) => (
              <li
                className="grid grid-cols-1 gap-2 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[9rem_1fr] sm:items-start sm:gap-4"
                key={lane.key}
              >
                <div className="flex items-baseline gap-2 sm:pt-1">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      (lane.key === "not_started" || lane.key === "complete") &&
                        "text-muted-foreground",
                    )}
                  >
                    {lane.label}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {lane.audiences.length}
                  </span>
                </div>
                {lane.audiences.length === 0 ? (
                  <span aria-hidden="true" className="text-sm text-muted-foreground sm:pt-1">
                    —
                  </span>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {lane.audiences.map((audience) => (
                      <li key={audience.key}>
                        <AudienceChip audience={audience} laneKey={lane.key} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function MatrixCard({ diagnosis }: { diagnosis: ReleaseDiagnosis }) {
  const { matrix } = diagnosis;
  const legend: DiagnosisCell[] = [
    "excellent",
    "good",
    "pass",
    "improve",
    "insufficient",
    ...(matrix.rows.some((row) => row.cells.includes("irrelevant"))
      ? (["irrelevant"] as const)
      : []),
    ...(matrix.rows.some((row) => row.cells.includes("none"))
      ? (["none"] as const)
      : []),
  ];
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={Grid3x3Icon}>量规评价</SectionTitle>
        <CardDescription>
          {matrix.status === "ready"
            ? `${matrix.sampleCount} 份当前正式修订已评价。按名册顺序排列，不是排名。`
            : "只看当前正式修订上已确认的量规评价。"}
        </CardDescription>
        {matrix.status === "ready" ? (
          <CardAction>
            <Button asChild size="sm" variant="ghost">
              <Link href={rosterHref(diagnosis.releaseId)}>
                打开名册
                <ChevronRightIcon />
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {matrix.status === "no_rubric" ? (
          <p className="text-sm text-muted-foreground">
            该发布使用旧版任务书，无量规，不参与统计。
          </p>
        ) : matrix.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            暂无已确认的量规评价；终稿提交并确认评价后，这里会按人显示各维度档位。
          </p>
        ) : (
          <>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full border-separate border-spacing-1 text-sm">
                <thead>
                  <tr>
                    <th className="sr-only" scope="col">
                      学生或小组
                    </th>
                    {matrix.dimensions.map((dimension) => (
                      <th
                        className="min-w-24 px-1 pb-1 text-center align-bottom text-xs font-medium text-muted-foreground"
                        key={dimension.dimensionIndex}
                        scope="col"
                      >
                        {dimension.dimensionName}
                        {dimension.weak ? (
                          <span className="mt-1 block">
                            <StatusBadge tone="resubmit">多数偏弱</StatusBadge>
                          </span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((row) => (
                    <tr key={row.submissionId}>
                      <th
                        className="max-w-48 pr-3 text-left font-normal whitespace-nowrap"
                        scope="row"
                      >
                        <Link
                          className="underline-offset-4 hover:underline"
                          href={`/teacher/submissions/${row.submissionId}`}
                        >
                          {row.audienceName}
                        </Link>
                        {row.phaseLabel ? (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {row.phaseLabel}
                          </span>
                        ) : null}
                        {!row.evaluated ? (
                          <span className="ml-1.5 text-xs text-status-pending-foreground">
                            待评价
                          </span>
                        ) : null}
                      </th>
                      {row.cells.map((cell, index) => (
                        <td
                          className={cn(
                            "h-8 rounded-md px-1 text-center text-xs",
                            cellStyle[cell].className,
                          )}
                          key={matrix.dimensions[index]?.dimensionIndex ?? index}
                        >
                          {cell === "irrelevant" || cell === "none" ? (
                            <span className="sr-only">{cellStyle[cell].label}</span>
                          ) : (
                            cellStyle[cell].label
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {matrix.status === "ready" ? (
                  <tfoot>
                    <tr>
                      <th
                        className="pt-1 pr-3 text-left text-xs font-normal whitespace-nowrap text-muted-foreground"
                        scope="row"
                      >
                        需改进或证据不足
                      </th>
                      {matrix.dimensions.map((dimension) => (
                        <td
                          className="pt-1 text-center text-xs text-muted-foreground tabular-nums"
                          key={dimension.dimensionIndex}
                        >
                          {dimension.sampleCount === 0 ? (
                            "—"
                          ) : dimension.lowCount > 0 ? (
                            <Link
                              className="font-medium text-foreground underline-offset-4 hover:underline"
                              href={rosterHref(
                                diagnosis.releaseId,
                                `?dim=${dimension.dimensionIndex}`,
                              )}
                            >
                              {`${dimension.sampleCount} 份中 ${dimension.lowCount} 份`}
                            </Link>
                          ) : (
                            `${dimension.sampleCount} 份中 0 份`
                          )}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {legend.map((cell) => (
                <li className="flex items-center gap-1.5" key={cell}>
                  <span
                    aria-hidden="true"
                    className={cn("size-3 rounded-sm", cellStyle[cell].className)}
                  />
                  {cellStyle[cell].label}
                </li>
              ))}
            </ul>
            <p className="type-caption text-muted-foreground">
              {`一列多数偏弱，多半与任务或讲解有关；一行多数偏弱，多半是这份作业需要个别支持。相关评价少于 ${WEAK_MIN_SAMPLE} 份的维度不下结论。`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SubmissionChip({
  submissionId,
  name,
  note,
}: {
  submissionId: string;
  name: string;
  note?: string | null;
}) {
  return (
    <Link
      className="flex max-w-56 items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-sm ring-1 ring-foreground/8 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      href={`/teacher/submissions/${submissionId}`}
    >
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary"
      >
        {Array.from(name)[0]}
      </span>
      <span className="truncate">{name}</span>
      {note ? (
        <span className="shrink-0 text-xs text-muted-foreground">{note}</span>
      ) : null}
    </Link>
  );
}

function EvidenceCard({ diagnosis }: { diagnosis: ReleaseDiagnosis }) {
  if (diagnosis.evidence.length === 0) {
    return null;
  }
  return (
    <Card className="scroll-mt-24" id="evidence">
      <CardHeader>
        <SectionTitle icon={ListChecksIcon}>证据交齐了吗</SectionTitle>
        <CardDescription>
          按各阶段当前正式提交里学生勾选的证据项统计。一项多数人没交，多半是任务书的问题。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {diagnosis.evidence.map((phase) => (
          <section className="flex flex-col gap-2" key={phase.phaseIndex}>
            <h3 className="flex items-baseline gap-2 text-sm font-medium">
              {phase.phaseName}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {`已交 ${phase.submittedCount} 份`}
              </span>
            </h3>
            <ul className="flex flex-col divide-y divide-border">
              {phase.items.map((item) => (
                <li
                  className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0"
                  key={item.evidenceIndex}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                    <p className="min-w-0 text-sm">
                      {item.description}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {item.typeLabel}
                      </span>
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* 一格一份提交：实心是勾选了，空心是没勾。 */}
                      <span
                        aria-hidden="true"
                        className="flex flex-wrap gap-0.5"
                      >
                        {Array.from({ length: phase.submittedCount }, (_, index) => (
                          <span
                            className={cn(
                              "h-4 w-2 rounded-sm",
                              index < item.doneCount
                                ? "bg-primary"
                                : "bg-status-closed ring-1 ring-border ring-inset",
                            )}
                            key={index}
                          />
                        ))}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {`${phase.submittedCount} 份中 ${item.doneCount} 份已勾选`}
                      </span>
                    </div>
                  </div>
                  {item.missing.length > 0 ? (
                    <ul className="flex flex-wrap items-center gap-2">
                      <li className="text-xs text-muted-foreground">没勾选：</li>
                      {item.missing.map((submission) => (
                        <li key={submission.submissionId}>
                          <SubmissionChip
                            name={submission.audienceName}
                            submissionId={submission.submissionId}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

const moveTone = {
  rose: "text-status-done-foreground",
  unchanged: "text-muted-foreground",
  fell: "text-status-resubmit-foreground",
} as const;

function LevelPill({ cell }: { cell: DiagnosisCell }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-14 items-center justify-center rounded-md px-1.5 text-xs",
        cellStyle[cell].className,
      )}
    >
      {cellStyle[cell].label}
    </span>
  );
}

function ResubmissionCard({ diagnosis }: { diagnosis: ReleaseDiagnosis }) {
  const { resubmission } = diagnosis;
  if (resubmission.reviseCount === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={RepeatIcon}>重交之后</SectionTitle>
        <CardDescription>
          {`要求重交 ${resubmission.reviseCount} 份，其中 ${resubmission.resubmittedCount} 份已重交。档位变化只比较重交前后都有量规评价的提交。`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {resubmission.awaiting.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-2">
            <li className="text-xs text-muted-foreground">还没重交：</li>
            {resubmission.awaiting.map((submission) => (
              <li key={submission.submissionId}>
                <SubmissionChip
                  name={submission.audienceName}
                  note={submission.phaseLabel}
                  submissionId={submission.submissionId}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {resubmission.pairs.length === 0 ? (
          <p className="text-muted-foreground">
            重交前后还没有成对的量规评价，暂时比较不了档位变化。
          </p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {resubmission.pairs.map((pair, index) => (
                <li
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                  key={`${pair.submissionId}-${index}`}
                >
                  <p>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/teacher/submissions/${pair.submissionId}`}
                    >
                      {pair.audienceName}
                    </Link>
                    {pair.phaseLabel ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {pair.phaseLabel}
                      </span>
                    ) : null}
                  </p>
                  <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {pair.moves.map((move) => (
                      <li
                        className="flex items-center justify-between gap-3"
                        key={move.dimensionName}
                      >
                        <span className="min-w-0 truncate text-muted-foreground">
                          {move.dimensionName}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <LevelPill cell={move.before} />
                          <ArrowRightIcon
                            aria-label={
                              move.movement === "rose"
                                ? "上升到"
                                : move.movement === "fell"
                                  ? "下降到"
                                  : "保持"
                            }
                            className={cn("size-4", moveTone[move.movement])}
                          />
                          <LevelPill cell={move.after} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="type-caption text-muted-foreground tabular-nums">
              {`按维度合计：上升 ${resubmission.rose}，持平 ${resubmission.unchanged}，下降 ${resubmission.fell}。`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SupportCard({ diagnosis }: { diagnosis: ReleaseDiagnosis }) {
  if (!diagnosis.support) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={LifeBuoyIcon}>你给的支架</SectionTitle>
        <CardDescription>
          每个学生或小组最近一次反馈里你选的支架层级。这是你对下一步帮扶多少的记录，学生看不到。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {diagnosis.support.tiers.map((tier) => (
            <li
              className="grid grid-cols-1 gap-2 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[7rem_1fr] sm:items-start sm:gap-4"
              key={tier.level}
            >
              <div className="flex items-baseline gap-2 sm:pt-1">
                <span className="text-sm font-medium">{tier.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tier.audiences.length}
                </span>
              </div>
              {tier.audiences.length === 0 ? (
                <span aria-hidden="true" className="text-sm text-muted-foreground sm:pt-1">
                  —
                </span>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {tier.audiences.map((audience) => (
                    <li key={audience.submissionId}>
                      <SubmissionChip
                        name={audience.name}
                        submissionId={audience.submissionId}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AnswersCard({
  releaseId,
  phases,
  canSummarize,
}: {
  releaseId: string;
  phases: readonly ReleaseAnswerSummaryPhase[];
  canSummarize: boolean;
}) {
  // 没有任何可读的作答，也没有存过归纳时，这一块对教师没有用。
  const shown = phases.filter((phase) => phase.answerCount > 0 || phase.latest);
  if (shown.length === 0) {
    return null;
  }
  return (
    <Card className="scroll-mt-24" id="answers">
      <CardHeader>
        <SectionTitle icon={MessagesSquareIcon}>作答里的共同点</SectionTitle>
        <CardDescription>
          由 AI 通读当前正式提交的文字作答后归纳，只描述写了什么，不评价学生。每一条都附学生原文，可点开核对。不读附件。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {shown.map((phase) => (
          <section
            className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
            key={phase.phaseIndex}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="flex items-baseline gap-2 text-sm font-medium">
                {phase.phaseLabel}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {`${phase.answerCount} 份有文字的作答`}
                </span>
              </h3>
              {canSummarize && phase.canSummarize ? (
                <AnswerSummaryTrigger
                  answerCount={phase.answerCount}
                  hasSummary={phase.latest !== null}
                  phaseIndex={phase.phaseIndex}
                  releaseId={releaseId}
                />
              ) : null}
            </div>
            {phase.latest ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm">{phase.latest.summary}</p>
                {phase.latest.themes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    这批作答里没有归纳出反复出现的共同点。
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {phase.latest.themes.map((theme, index) => (
                      <li
                        className="flex flex-col gap-2 rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-foreground/5"
                        key={`${phase.latest!.id}-${index}`}
                      >
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <StatusBadge tone={theme.kind === "GAP" ? "pending" : "done"}>
                            {answerThemeKindLabels[theme.kind]}
                          </StatusBadge>
                          {theme.statement}
                        </p>
                        <ul className="flex flex-col gap-1.5">
                          {theme.sources.map((source) => (
                            <li
                              className="flex flex-wrap items-baseline gap-x-2 text-sm"
                              key={source.submissionId}
                            >
                              <Link
                                className="shrink-0 font-medium underline-offset-4 hover:underline"
                                href={`/teacher/submissions/${source.submissionId}`}
                              >
                                {source.audienceName}
                              </Link>
                              <q className="text-muted-foreground">{source.quote}</q>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="type-caption text-muted-foreground">
                  {`基于 ${phase.latest.basisCount} 份作答 · `}
                  <LocalizedDateTime dateTime={phase.latest.createdAt} />
                  {" 生成"}
                  {phase.latest.changedSinceCount > 0
                    ? ` · 之后有 ${phase.latest.changedSinceCount} 份新提交或重交，未计入`
                    : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {phase.canSummarize
                  ? canSummarize
                    ? "还没有归纳过。"
                    : "还没有归纳过；AI 当前不可用。"
                  : "有文字的作答不足 3 份，直接读原文更快。"}
              </p>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

function TaskBookSignalsCard({ signals }: { signals: ReleaseTaskBookSignals }) {
  if (signals.signals.length === 0 || !signals.copySource) {
    return null;
  }
  const copyHref = `/teacher/activities/copy?${new URLSearchParams({
    kind: "RELEASE",
    id: signals.copySource.id,
    version: String(signals.copySource.version),
  }).toString()}`;
  return (
    <Card className="scroll-mt-24" id="task-book">
      <CardHeader>
        <SectionTitle icon={NotebookPenIcon}>带回任务书</SectionTitle>
        <CardDescription>
          上面的数据里，这几条多半与任务书的写法有关。已发布的任务书不会改动；复制成新草稿后，这些信号会显示在草稿页，版本检查也会参考。
        </CardDescription>
        <CardAction>
          <Button asChild size="sm" variant="outline">
            <Link href={copyHref}>
              复制这份任务书去修改
              <ChevronRightIcon />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {signals.signals.map((signal, index) => (
            <li
              className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
              key={`${signal.target}-${signal.kind}-${index}`}
            >
              <p className="text-sm font-medium">{signal.sourceLabel}</p>
              <p className="text-sm text-muted-foreground">{signal.text}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default async function TeacherInsightsPage({
  searchParams,
}: {
  searchParams?: InsightsSearchParams;
}) {
  const requestedReleaseId = z
    .uuid()
    .safeParse(one((await searchParams)?.release).trim());
  let dashboard: TeacherInsightsDashboard;
  let diagnosis: ReleaseDiagnosis | null = null;
  let answerPhases: ReleaseAnswerSummaryPhase[] | null = null;
  let taskBookSignals: ReleaseTaskBookSignals | null = null;
  let selectedId: string | null = null;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    dashboard = await getTeacherInsights(database, context, {});
    const options = dashboard.releaseOptions;
    // 一次只看一个活动（D-084）。没指定或指定的不可见时，落到最近一个开放中的活动。
    selectedId =
      (requestedReleaseId.success
        ? options.find((option) => option.id === requestedReleaseId.data)?.id
        : undefined) ??
      options.find((option) => option.status === "ACTIVE")?.id ??
      options[0]?.id ??
      null;
    if (selectedId) {
      diagnosis = await getTeacherReleaseDiagnosis(database, context, {
        releaseId: selectedId,
      });
      answerPhases = await getReleaseAnswerSummaries(database, context, selectedId);
      taskBookSignals = await getReleaseTaskBookSignals(database, context, selectedId);
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <TeacherAccessGate code={error.code} returnPath="/teacher/insights" />
      );
    }
    if (
      error instanceof TeacherActivityQueryError &&
      error.code === "WRONG_ROLE" &&
      error.actorName
    ) {
      return (
        <WorkspaceRoleGate
          actorName={error.actorName}
          currentAudience="学生"
          requestedAudience="教师"
        />
      );
    }
    if (error instanceof TeacherActivityQueryError || error instanceof ZodError) {
      notFound();
    }
    throw error;
  }

  return (
    <TeacherPage
      actorName={dashboard.actor.displayName}
      breadcrumb={[teacherHomeCrumb, { label: "过程诊断" }]}
    >
      <div className={cn("mx-auto flex w-full max-w-6xl flex-col gap-6", revealChildren)}>
        <PageHeader
          description="只统计正式提交与已确认的反馈、评价。"
          title="过程诊断"
        />

        {dashboard.releaseOptions.length === 0 ? (
          <EmptyState title="暂无可查看的发布">
            发布活动并保持班级管理权后，这里会出现过程诊断。
          </EmptyState>
        ) : (
          <ReleaseTabs options={dashboard.releaseOptions} selectedId={selectedId} />
        )}

        {diagnosis ? (
          <>
            <AlertsCard diagnosis={diagnosis} />
            <LanesCard diagnosis={diagnosis} />
            <EvidenceCard diagnosis={diagnosis} />
            {answerPhases ? (
              <AnswersCard
                canSummarize={isActivityAssistantEnabled()}
                phases={answerPhases}
                releaseId={diagnosis.releaseId}
              />
            ) : null}
            <MatrixCard diagnosis={diagnosis} />
            <ResubmissionCard diagnosis={diagnosis} />
            <SupportCard diagnosis={diagnosis} />
            {taskBookSignals ? <TaskBookSignalsCard signals={taskBookSignals} /> : null}
          </>
        ) : null}
      </div>
    </TeacherPage>
  );
}
