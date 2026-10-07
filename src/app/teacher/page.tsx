import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChartLineIcon,
  ChevronRightIcon,
  InboxIcon,
  ListChecksIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react";
import { ZodError } from "zod";
import { Badge } from "@/components/ui/badge";
import { BorderBeam } from "@/components/ui/border-beam";
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
import { Progress } from "@/components/ui/progress";
import { LocalizedDateTime } from "../_components/localized-date-time";
import { PageHeader } from "../_components/page-header";
import { Reveal } from "../_components/reveal";
import { EmptyState, StatusBadge, type StatusTone } from "../_components/ui";
import { WorkspaceRoleGate } from "../_components/workspace-shell";
import { AuthenticationError } from "../../server/auth/current-actor";
import { createUiCommandContext } from "../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../server/db/client";
import {
  getTeacherActivityDashboard,
  TeacherActivityQueryError,
  type TeacherActivityDashboard,
} from "../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
} from "./_components/teacher-shell";

const releaseStatus = {
  ACTIVE: { label: "开放中", tone: "neutral" },
  CLOSED: { label: "已关闭", tone: "closed" },
  ARCHIVED: { label: "已封存", tone: "closed" },
} as const satisfies Record<string, { label: string; tone: StatusTone }>;

const releaseStatusOrder = { ACTIVE: 0, CLOSED: 1, ARCHIVED: 2 } as const;

type DashboardRelease = TeacherActivityDashboard["releases"][number];
type Attention = NonNullable<DashboardRelease["attention"]>;

// 待重交在等学生，不是教师此刻能做的事；只有待反馈、待评价算「等你评阅」。
const attentionKinds = [
  { queue: "feedback", label: "待反馈", tone: "pending", key: "pendingFeedbackCount" },
  { queue: "evaluation", label: "待评价", tone: "pending", key: "pendingEvaluationCount" },
  { queue: "resubmit", label: "待重交", tone: "resubmit", key: "awaitingResubmissionCount" },
] as const satisfies readonly {
  queue: string;
  label: string;
  tone: StatusTone;
  key: keyof Attention;
}[];

function rosterHref(releaseId: string, queue?: string) {
  return `/teacher/releases/${releaseId}/submissions${queue ? `?queue=${queue}` : ""}`;
}

function AttentionRow({
  release,
  attention,
}: {
  release: DashboardRelease;
  attention: Attention;
}) {
  const kinds = attentionKinds.filter((kind) => attention[kind.key] > 0);
  const reviewKind = kinds.find((kind) => kind.queue !== "resubmit");
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-medium">{release.title}</p>
        <p className="type-caption text-muted-foreground">
          {release.classroomName}
          {release.dueAt ? (
            <>
              {" · "}
              <LocalizedDateTime dateTime={release.dueAt} /> 截止
            </>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {kinds.map((kind) => (
          <Link
            className="rounded-4xl transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            href={rosterHref(release.id, kind.queue)}
            key={kind.queue}
          >
            <StatusBadge tone={kind.tone}>
              {`${kind.label} ${attention[kind.key]}`}
            </StatusBadge>
          </Link>
        ))}
        {/* 有要评阅的就是实心主按钮，直接进对应队列；只剩待重交时只是去看看。 */}
        <Button asChild size="sm" variant={reviewKind ? "default" : "outline"}>
          <Link href={rosterHref(release.id, reviewKind?.queue ?? "resubmit")}>
            {reviewKind ? "开始评阅" : "查看"}
            <ChevronRightIcon />
          </Link>
        </Button>
      </div>
    </li>
  );
}

function ReleaseTile({ release }: { release: DashboardRelease }) {
  const status = releaseStatus[release.status];
  const progress = release.progress;
  const percent =
    progress && progress.cohortSize > 0
      ? Math.round(
          ((progress.completeCount ?? progress.submittedCount) / progress.cohortSize) * 100,
        )
      : 0;
  const ended = release.status !== "ACTIVE";
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl bg-foreground/[0.03] p-4 ring-1 ring-foreground/5",
        ended && "opacity-75",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 font-medium">{release.title}</p>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      {progress ? (
        <div className="flex flex-col gap-1.5">
          <Progress
            aria-label={`${release.title} 提交进度`}
            className="h-1.5"
            value={percent}
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {progress.completeCount === null
                ? `${progress.submittedCount}/${progress.cohortSize} 已提交`
                : `${progress.completeCount}/${progress.cohortSize} 全部完成`}
            </span>
            {release.dueAt ? (
              <span className="tabular-nums">
                <LocalizedDateTime dateTime={release.dueAt} /> 截止
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">管理权已转交，不能再查看提交。</p>
      )}
      {release.canViewSubmissions ? (
        <div className="mt-auto flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={rosterHref(release.id)}>
              <ListChecksIcon />
              名册
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/teacher/insights?release=${release.id}`}>
              <ChartLineIcon />
              过程诊断
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function sortReleases(releases: readonly DashboardRelease[]) {
  return [...releases].sort(
    (a, b) => releaseStatusOrder[a.status] - releaseStatusOrder[b.status],
  );
}

export default async function TeacherDashboardPage() {
  let dashboard;
  try {
    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    dashboard = await getTeacherActivityDashboard(database, context, {});
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <TeacherAccessGate code={error.code} returnPath="/teacher" />;
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

  const actionable = dashboard.releases
    .filter(
      (release) =>
        release.attention !== null &&
        (release.attention.pendingFeedbackCount > 0 ||
          release.attention.pendingEvaluationCount > 0 ||
          release.attention.awaitingResubmissionCount > 0),
    )
    .map((release) => ({ release, attention: release.attention! }));
  const reviewCount = actionable.reduce(
    (sum, { attention }) =>
      sum + attention.pendingFeedbackCount + attention.pendingEvaluationCount,
    0,
  );
  const managedNames = new Set(
    dashboard.classrooms.map((classroom) => classroom.name),
  );
  const orphanReleases = dashboard.releases.filter(
    (release) => !managedNames.has(release.classroomName),
  );

  return (
    <TeacherPage
      actorName={dashboard.actor.displayName}
      breadcrumb={[{ label: "教师工作台" }]}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <PageHeader
          actions={
            <>
              <Button asChild variant="outline">
                <Link href="/teacher/classrooms/new">
                  <UsersIcon />
                  新建班级
                </Link>
              </Button>
              <Button asChild>
                <Link href="/teacher/activities/new">
                  <PlusIcon />
                  新建学习活动
                </Link>
              </Button>
            </>
          }
          title={
            reviewCount > 0 ? (
              <>
                <span className="tabular-nums">{reviewCount}</span> 份提交等你评阅
              </>
            ) : (
              "没有等你评阅的提交"
            )
          }
        />

        {/* 第一层：此刻要做的事。每一行直接进对应的评阅队列（D-069）。 */}
        {actionable.length > 0 ? (
          <Reveal delay={0.06}>
            <Card className="relative">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <InboxIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  待处理
                </CardTitle>
                <CardAction>
                  <Badge variant="outline">{`${actionable.length} 个活动`}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {actionable.map(({ release, attention }) => (
                    <AttentionRow
                      attention={attention}
                      key={release.id}
                      release={release}
                    />
                  ))}
                </ul>
              </CardContent>
              {reviewCount > 0 ? (
                <BorderBeam
                  colorFrom="var(--primary)"
                  colorTo="var(--aurora-2)"
                  duration={10}
                  size={120}
                />
              ) : null}
            </Card>
          </Reveal>
        ) : null}

        {/* 第二层：班级与发布。每个班一整行，活动按卡片平铺。 */}
        <Reveal delay={0.14}>
          <section aria-labelledby="classrooms-title" className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="type-section-title" id="classrooms-title">
                我的班级
              </h2>
              {dashboard.releases.length > 0 ? (
                <p className="type-caption text-muted-foreground">
                  {`${dashboard.classrooms.length} 个班级 · ${dashboard.releases.length} 个已发布活动`}
                </p>
              ) : null}
            </div>
            {dashboard.classrooms.length === 0 ? (
              <EmptyState
                action={
                  <Button asChild variant="outline">
                    <Link href="/teacher/classrooms/new">新建班级</Link>
                  </Button>
                }
                title="还没有班级"
              >
                新建一个班级后就能导入学生名单，再向这个班级发布活动。
              </EmptyState>
            ) : (
              dashboard.classrooms.map((classroom) => {
                const releases = sortReleases(
                  dashboard.releases.filter(
                    (release) => release.classroomName === classroom.name,
                  ),
                );
                return (
                  <Card key={classroom.id}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-9 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary"
                        >
                          {Array.from(classroom.name)[0]}
                        </span>
                        {classroom.name}
                      </CardTitle>
                      <CardAction>
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/teacher/classrooms/${classroom.id}/members`}
                          >
                            <UsersIcon />
                            {`${classroom.currentMemberCount} 名成员`}
                          </Link>
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      {releases.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          还没有向这个班级发布活动。在
                          <Link
                            className="mx-1 text-primary underline-offset-4 hover:underline"
                            href="/teacher/activities"
                          >
                            活动设计
                          </Link>
                          里完成草稿后发布。
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {releases.map((release) => (
                            <ReleaseTile key={release.id} release={release} />
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
            {orphanReleases.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>已不在管理范围的班级</CardTitle>
                  <CardDescription>管理权已转交，只保留发布记录，不能再查看提交。</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {sortReleases(orphanReleases).map((release) => (
                      <ReleaseTile key={release.id} release={release} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </section>
        </Reveal>
      </div>
    </TeacherPage>
  );
}
