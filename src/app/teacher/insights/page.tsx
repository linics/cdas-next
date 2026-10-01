import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  BellRingIcon,
  ChevronRightIcon,
  FootprintsIcon,
  Grid3x3Icon,
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
                  <Link href={rosterHref(diagnosis.releaseId, alert.action.query)}>
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

function ImprovementCard({ diagnosis }: { diagnosis: ReleaseDiagnosis }) {
  const { improvement } = diagnosis;
  if (improvement.reviseCount === 0) {
    return null;
  }
  const moves = [
    ["上升", improvement.rose],
    ["持平", improvement.unchanged],
    ["下降", improvement.fell],
  ] as const;
  return (
    <Card>
      <CardHeader>
        <SectionTitle icon={RepeatIcon}>重交之后</SectionTitle>
        <CardDescription>
          档位变化只比较重交前后都有量规评价的提交。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>
          {`要求重交 ${improvement.reviseCount} 份，其中 ${improvement.resubmittedCount} 份已重交。`}
        </p>
        {improvement.evaluationPairs === 0 ? (
          <p className="text-muted-foreground">
            重交前后还没有成对的量规评价，暂时比较不了档位变化。
          </p>
        ) : (
          <p className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
            <span className="text-muted-foreground">
              {`${improvement.evaluationPairs} 份可比较，按维度：`}
            </span>
            {moves.map(([label, count]) => (
              <span key={label}>{`${label} ${count}`}</span>
            ))}
          </p>
        )}
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
            <MatrixCard diagnosis={diagnosis} />
            <ImprovementCard diagnosis={diagnosis} />
          </>
        ) : null}
      </div>
    </TeacherPage>
  );
}
