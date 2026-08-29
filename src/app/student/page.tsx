import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { LocalizedDateTime } from "../_components/localized-date-time";
import { EmptyState, StatusBadge } from "../_components/ui";
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
import styles from "./student-dashboard.module.css";

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
    detail: "教师已要求修改，请按反馈调整后重新提交。",
  },
  active: {
    number: "02",
    title: "进行中",
    detail: "尚未开始、已提交待反馈或已收到反馈的活动都在这里。",
  },
  closed: {
    number: "03",
    title: "已关闭",
    detail: "仅可查看，不能再保存或提交。",
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

function releaseStatusTone(release: StudentRelease): "neutral" | "warning" | "success" | "info" {
  if (!release.access.canWrite) {
    return "neutral";
  }
  if (release.submission.followUp === "AWAITING_RESUBMISSION") {
    return "warning";
  }
  if (
    release.submission.hasCurrentEvaluation ||
    release.submission.hasCurrentFeedback
  ) {
    return "success";
  }
  if (
    release.submission.latestRevisionNumber > 0 &&
    !release.submission.hasWorkingCopy
  ) {
    return "info";
  }
  return "warning";
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
      className={styles.releaseRow}
      href={`/student/releases/${release.id}`}
      aria-label={`打开活动：${release.snapshot.title}`}
    >
      <div className={styles.releaseCopy}>
        <h3>{release.snapshot.title}</h3>
        <p>{release.snapshot.summary}</p>
        <span>{progressParts.join(" · ")}</span>
      </div>
      <dl className={styles.releaseDates}>
        <div>
          <dt>发布时间</dt>
          <dd>
            <LocalizedDateTime dateTime={release.publishedAt} />
          </dd>
        </div>
        <div>
          <dt>截止时间</dt>
          <dd>
            {release.dueAt ? (
              <LocalizedDateTime dateTime={release.dueAt} />
            ) : (
              "未设置"
            )}
            {isPastDue ? <strong>仍可迟交</strong> : null}
          </dd>
        </div>
      </dl>
      <div className={styles.releaseAction}>
        <StatusBadge tone={releaseStatusTone(release)}>{releaseStatusLabel(release)}</StatusBadge>
        <small>
          打开活动 <i aria-hidden="true">→</i>
        </small>
      </div>
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
    <section className={styles.releaseGroup} aria-labelledby={`${groupKey}-title`}>
      <header className={styles.groupHeading}>
        <span>{detail.number}</span>
        <div>
          <h2 id={`${groupKey}-title`}>{detail.title}</h2>
          <p>{detail.detail}</p>
        </div>
        <strong>{releases.length} 项</strong>
      </header>
      <div className={styles.releaseList}>
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
      <div className={styles.dashboardMain}>
        <header className={styles.dashboardHeader}>
          <div>
            <p className={styles.eyebrow}>学生工作台 / 学习活动</p>
            <h1>我的学习活动</h1>
            <p>这里汇总所有对你开放的学习活动。</p>
          </div>
          {/* 计数跟着分组走，同一套口径，不再另立五个状态。 */}
          <dl className={styles.summaryLine}>
            <div>
              <dt>待重交</dt>
              <dd>{grouped.resubmit.length}</dd>
            </div>
            <div>
              <dt>进行中</dt>
              <dd>{grouped.active.length}</dd>
            </div>
            <div>
              <dt>已关闭</dt>
              <dd>{grouped.closed.length}</dd>
            </div>
          </dl>
        </header>

        {releaseList.releases.length === 0 ? (
          <EmptyState title="还没有对你开放的学习活动">
            教师发布到你的班级后，活动会自动出现在这里。
          </EmptyState>
        ) : (
          <div className={styles.groups}>
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
