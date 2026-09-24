import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon, PlusIcon, UsersIcon } from "lucide-react";
import { ZodError } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocalizedDateTime } from "../_components/localized-date-time";
import { PageHeader } from "../_components/page-header";
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

type DashboardRelease = TeacherActivityDashboard["releases"][number];
type Attention = NonNullable<DashboardRelease["attention"]>;

function attentionBadges(attention: Attention) {
  return (
    [
      ["待反馈", attention.pendingFeedbackCount, "pending"],
      ["待评价", attention.pendingEvaluationCount, "pending"],
      ["待重交", attention.awaitingResubmissionCount, "resubmit"],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([label, count, tone]) => (
      <StatusBadge key={label} tone={tone}>
        {`${label} ${count}`}
      </StatusBadge>
    ));
}

function ReleaseProgressRow({ release }: { release: DashboardRelease }) {
  const status = releaseStatus[release.status];
  const progress = release.progress;
  const percent =
    progress && progress.cohortSize > 0
      ? Math.round((progress.submittedCount / progress.cohortSize) * 100)
      : 0;
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium">{release.title}</span>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      {progress ? (
        <Progress
          aria-label={`${release.title} 提交进度`}
          className="h-1.5"
          value={percent}
        />
      ) : null}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">
          {progress
            ? `${progress.submittedCount}/${progress.cohortSize} 已正式提交`
            : "无查看权限"}
        </span>
        {release.dueAt ? (
          <span className="tabular-nums">
            <LocalizedDateTime dateTime={release.dueAt} /> 截止
          </span>
        ) : null}
      </div>
    </>
  );

  if (!release.canViewSubmissions) {
    return <div className="flex flex-col gap-2 rounded-lg p-3">{body}</div>;
  }
  return (
    <Link
      className="flex flex-col gap-2 rounded-lg p-3 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      href={`/teacher/releases/${release.id}/submissions`}
    >
      {body}
    </Link>
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
  const totals = actionable.reduce(
    (sum, { attention }) => ({
      feedback: sum.feedback + attention.pendingFeedbackCount,
      evaluation: sum.evaluation + attention.pendingEvaluationCount,
      resubmission: sum.resubmission + attention.awaitingResubmissionCount,
    }),
    { feedback: 0, evaluation: 0, resubmission: 0 },
  );
  const managedNames = new Set(
    dashboard.classrooms.map((classroom) => classroom.name),
  );
  const orphanReleases = dashboard.releases.filter(
    (release) => !managedNames.has(release.classroomName),
  );
  const statCards = (
    [
      ["待反馈", totals.feedback, "学生已提交，等你写反馈"],
      ["待评价", totals.evaluation, "已反馈，还没做量规评价"],
      ["待重交", totals.resubmission, "已要求修改，等学生重交"],
    ] as const
  ).filter(([, count]) => count > 0);

  return (
    <TeacherPage
      actorName={dashboard.actor.displayName}
      breadcrumb={[{ label: "教师工作台" }]}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
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
                  设计新活动
                </Link>
              </Button>
            </>
          }
          description="先处理等你评阅的学生提交。已发布的活动按班级排列，没发布的草稿在「活动设计」里。"
          title="待处理的提交与班级"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map(([label, count, hint]) => (
            <Card key={label}>
              <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-3xl font-semibold tabular-nums">
                  {count}
                </CardTitle>
              </CardHeader>
              <CardFooter className="text-sm text-muted-foreground">
                {hint}
              </CardFooter>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardDescription>任教班级</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">
                {dashboard.classrooms.length}
              </CardTitle>
            </CardHeader>
            <CardFooter className="text-sm text-muted-foreground">
              {`共 ${dashboard.releases.length} 个已发布活动`}
            </CardFooter>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>待办</CardTitle>
            <CardDescription>有学生提交在等你处理的活动</CardDescription>
            <CardAction>
              <Badge variant="outline">{`${actionable.length} 项`}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {actionable.length === 0 ? (
              <EmptyState title="暂时没有待办">
                当前没有待反馈、待评价或待重交的提交。
              </EmptyState>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>活动</TableHead>
                    <TableHead>班级</TableHead>
                    <TableHead>待办</TableHead>
                    <TableHead className="w-0">
                      <span className="sr-only">操作</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actionable.map(({ release, attention }) => (
                    <TableRow key={release.id}>
                      <TableCell className="font-medium">
                        {release.title}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {release.classroomName}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {attentionBadges(attention)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/teacher/releases/${release.id}/submissions`}
                          >
                            去处理
                            <ChevronRightIcon />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <section aria-labelledby="classrooms-title" className="flex flex-col gap-4">
          <h2 className="type-section-title" id="classrooms-title">
            任教班级
          </h2>
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
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {dashboard.classrooms.map((classroom) => {
                const releases = dashboard.releases.filter(
                  (release) => release.classroomName === classroom.name,
                );
                return (
                  <Card key={classroom.id}>
                    <CardHeader>
                      <CardTitle>{classroom.name}</CardTitle>
                      <CardAction>
                        <Button asChild size="sm" variant="ghost">
                          <Link
                            href={`/teacher/classrooms/${classroom.id}/members`}
                          >
                            <UsersIcon />
                            {`${classroom.currentMemberCount} 名成员`}
                          </Link>
                        </Button>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-1">
                      {releases.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          还没有向这个班级发布活动。
                        </p>
                      ) : (
                        releases.map((release) => (
                          <ReleaseProgressRow
                            key={release.id}
                            release={release}
                          />
                        ))
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {orphanReleases.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>已不在管理范围的班级</CardTitle>
                <CardDescription>历史发布</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {orphanReleases.map((release) => (
                  <ReleaseProgressRow key={release.id} release={release} />
                ))}
              </CardContent>
            </Card>
          ) : null}
          <p className="text-sm text-muted-foreground">
            只有班级管理教师能发布活动、查看提交。管理权换人后，历史发布记录还在，但不能再看里面的提交内容。
          </p>
        </section>
      </div>
    </TeacherPage>
  );
}
