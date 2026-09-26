import type { Metadata } from "next";
import { cn } from "@/lib/utils";
import { revealChildren } from "../_components/reveal";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { LocalizedDateTime } from "../_components/localized-date-time";
import { ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NumberTicker } from "@/components/ui/number-ticker";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "../_components/page-header";
import { EmptyState, StatusBadge, type StatusTone } from "../_components/ui";
import {
  WorkspaceRoleGate,
  WorkspaceShell,
} from "../_components/workspace-shell";
import { AuthenticationError } from "../../server/auth/current-actor";
import { createUiCommandContext } from "../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../server/db/client";
import {
  listStudentReleases,
  StudentReleaseListQueryError,
  type StudentReleaseList,
} from "../../server/queries/student-releases";
import { StudentAccessGate } from "./_components/student-shell";

const studentNavigation = [
  { href: "/student", label: "我的活动" },
] as const;

export const metadata: Metadata = {
  title: "我的学习活动 | CDAS Next",
  description: "查看可见活动、提交状态、教师反馈与量规评价",
};

type StudentRelease = StudentReleaseList["releases"][number];
type ReleaseGroupKey = "resubmit" | "active" | "closed";

// 按「急不急」分组，不按数据状态分：学生先看要不要重交，再看还在进行的，
// 最后才是已经关掉的。原来的六组（待提交/已提交/已有反馈/待重交/已有评价/历史）
// 是照着提交状态机切的，读的人得先懂状态机。
const groupDetails = {
  resubmit: {
    number: "01",
    title: "待重交",
    detail: "按老师的反馈修改后重新提交。",
  },
  active: {
    number: "02",
    title: "进行中",
    detail: "",
  },
  closed: {
    number: "03",
    title: "已关闭",
    detail: "只能查看，不能再提交。",
  },
} satisfies Record<
  ReleaseGroupKey,
  { number: string; title: string; detail: string }
>;

function groupRelease(release: StudentRelease): ReleaseGroupKey {
  if (!release.access.canWrite) {
    return "closed";
  }
  if (release.submission.followUp === "AWAITING_RESUBMISSION") {
    return "resubmit";
  }
  return "active";
}

function releaseStatusLabel(release: StudentRelease): string {
  if (release.status === "ARCHIVED") {
    return "已封存";
  }
  if (release.status === "CLOSED") {
    return "已关闭";
  }
  if (!release.access.canWrite) {
    return "历史只读";
  }
  if (release.submission.followUp === "AWAITING_RESUBMISSION") {
    return "待重交";
  }
  if (release.submission.followUp === "RESUBMISSION_IN_PROGRESS") {
    return "重交中";
  }
  if (release.submission.hasWorkingCopy) {
    return release.submission.latestRevisionNumber > 0
      ? "重交草稿"
      : "草稿未提交";
  }
  if (release.submission.hasCurrentEvaluation) {
    return "已有评价";
  }
  if (release.submission.hasCurrentFeedback) {
    return "已有反馈";
  }
  if (release.submission.latestRevisionNumber > 0) {
    return `第 ${release.submission.latestRevisionNumber} 版已提交`;
  }
  return "尚未开始";
}

function releaseStatusTone(release: StudentRelease): StatusTone {
  if (!release.access.canWrite) {
    return "closed";
  }
  if (release.submission.followUp === "AWAITING_RESUBMISSION") {
    return "resubmit";
  }
  if (
    release.submission.hasCurrentEvaluation ||
    release.submission.hasCurrentFeedback
  ) {
    return "done";
  }
  if (
    release.submission.latestRevisionNumber > 0 &&
    !release.submission.hasWorkingCopy
  ) {
    return "neutral";
  }
  // 尚未开始或有未提交草稿：轮到学生动手。
  return "pending";
}

function ReleaseRow({
  release,
  now,
}: {
  release: StudentRelease;
  now: Date;
}) {
  const isPastDue =
    release.status === "ACTIVE" &&
    release.access.canWrite &&
    release.dueAt !== null &&
    now > new Date(release.dueAt);
  const progressParts = [
    release.submission.latestRevisionNumber > 0
      ? `已提交第 ${release.submission.latestRevisionNumber} 版`
      : "尚未正式提交",
    release.submission.hasWorkingCopy ? "有未提交草稿" : null,
    release.submission.followUp === "AWAITING_RESUBMISSION" ? "待重交" : null,
    release.submission.followUp === "RESUBMISSION_IN_PROGRESS" ? "重交中" : null,
    release.submission.hasCurrentFeedback ? "已有反馈" : null,
    release.submission.hasCurrentEvaluation ? "当前版已有量规评价" : null,
  ].filter((part): part is string => part !== null);

  return (
    <Link
      aria-label={`打开活动：${release.snapshot.title}`}
      className="group block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      href={`/student/releases/${release.id}`}
    >
      <Card className="transition-[transform,box-shadow] duration-300 group-hover:-translate-y-0.5 group-hover:shadow-lg motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        <CardHeader>
          <CardTitle className="text-base">{release.snapshot.title}</CardTitle>
          <CardDescription className="line-clamp-2">
            {release.snapshot.summary}
          </CardDescription>
          <CardAction>
            <StatusBadge tone={releaseStatusTone(release)}>
              {releaseStatusLabel(release)}
            </StatusBadge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span>{progressParts.join(" · ")}</span>
          <span className="tabular-nums">
            发布 <LocalizedDateTime dateTime={release.publishedAt} />
          </span>
          <span className="flex items-center gap-2 tabular-nums">
            截止{" "}
            {release.dueAt ? (
              <LocalizedDateTime dateTime={release.dueAt} />
            ) : (
              "未设置"
            )}
            {isPastDue ? (
              <StatusBadge tone="resubmit">仍可迟交</StatusBadge>
            ) : null}
          </span>
          <span className="ml-auto flex items-center gap-1 font-medium text-foreground">
            打开活动
            <ChevronRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </CardFooter>
      </Card>
    </Link>
  );
}

function ReleaseGroup({
  groupKey,
  releases,
  now,
}: {
  groupKey: ReleaseGroupKey;
  releases: StudentRelease[];
  now: Date;
}) {
  if (releases.length === 0) {
    return null;
  }
  const detail = groupDetails[groupKey];
  return (
    <section
      aria-labelledby={`${groupKey}-title`}
      className="flex flex-col gap-3"
    >
      <header className="flex items-baseline gap-3">
        <h2 className="type-section-title" id={`${groupKey}-title`}>
          {detail.title}
        </h2>
        <Badge variant="secondary">{`${releases.length} 项`}</Badge>
        {detail.detail ? (
          <p className="text-sm text-muted-foreground">{detail.detail}</p>
        ) : null}
      </header>
      <div className="flex flex-col gap-3">
        {releases.map((release) => (
          <ReleaseRow release={release} now={now} key={release.id} />
        ))}
      </div>
    </section>
  );
}

export default async function StudentDashboardPage() {
  await connection();
  let context;
  let releaseList: StudentReleaseList;

  try {
    context = await createUiCommandContext();
    const database = getDatabaseClient();
    releaseList = await listStudentReleases(database, context, {});
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <StudentAccessGate code={error.code} returnPath="/student" />;
    }
    if (
      error instanceof StudentReleaseListQueryError &&
      error.code === "WRONG_ROLE" &&
      error.actorName
    ) {
      return (
        <WorkspaceRoleGate
          actorName={error.actorName}
          currentAudience="教师"
          requestedAudience="学生"
        />
      );
    }
    if (
      error instanceof StudentReleaseListQueryError || error instanceof ZodError
    ) {
      notFound();
    }
    throw error;
  }

  const now = context.clock();
  const grouped = {
    resubmit: [] as StudentRelease[],
    active: [] as StudentRelease[],
    closed: [] as StudentRelease[],
  };
  for (const release of releaseList.releases) {
    grouped[groupRelease(release)].push(release);
  }

  return (
    <WorkspaceShell
      audience="学生"
      actorName={releaseList.actor.displayName}
      breadcrumb={[{ label: "我的学习活动" }]}
      navigation={studentNavigation}
    >
      <div className={cn("mx-auto flex w-full max-w-5xl flex-col gap-8", revealChildren)}>
        <PageHeader title="我的学习活动" />
        {/* 计数跟着分组走，同一套口径，不再另立五个状态。 */}
        <dl className="grid grid-cols-3 gap-4">
          {(Object.keys(groupDetails) as ReleaseGroupKey[]).map((groupKey) => (
            <Card key={groupKey}>
              <CardHeader>
                <dt>
                  <CardDescription>{groupDetails[groupKey].title}</CardDescription>
                </dt>
                <dd>
                  <CardTitle className="text-3xl font-semibold">
                    <NumberTicker value={grouped[groupKey].length} />
                  </CardTitle>
                </dd>
              </CardHeader>
            </Card>
          ))}
        </dl>

        {releaseList.releases.length === 0 ? (
          <EmptyState title="还没有对你开放的学习活动">
            教师发布到你的班级后，活动会自动出现在这里。
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-10">
            {(Object.keys(groupDetails) as ReleaseGroupKey[]).map(
              (groupKey) => (
                <ReleaseGroup
                  groupKey={groupKey}
                  releases={grouped[groupKey]}
                  now={now}
                  key={groupKey}
                />
              ),
            )}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
