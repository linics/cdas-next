import { SignInButton, SignOutButton } from "@clerk/nextjs";
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
import styles from "./student-dashboard.module.css";

const studentNavigation = [
  { href: "/student", label: "我的活动" },
] as const;

export const metadata: Metadata = {
  title: "我的学习活动 | CDAS Next",
  description: "查看可见活动、提交状态、教师反馈与量规评价",
};

function AccessUnavailable({
  code,
}: {
  code: AuthenticationError["code"];
}) {
  const copy =
    code === "AUTH_NOT_CONFIGURED"
      ? {
          eyebrow: "登录服务未配置",
          title: "学习活动入口尚未开放",
          detail:
            "系统当前无法验证学生身份，因此不会读取或显示任何班级活动。配置 Clerk 后再从真实学生账号进入。",
        }
      : code === "USER_NOT_PROVISIONED"
        ? {
            eyebrow: "账号尚未创建",
            title: "找不到对应的学生身份",
            detail:
              "当前登录账号尚未关联到 CDAS Next 用户。请由管理者完成账号创建与班级成员设置。",
          }
        : {
            eyebrow: "需要登录",
            title: "登录后查看自己的学习活动",
            detail:
              "未登录时不会显示班级活动、提交进度或反馈状态。",
          };

  return (
    <WorkspaceShell audience="学生">
      <section className={styles.accessGate}>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        <div className={styles.accessActions}>
          {code === "UNAUTHENTICATED" ? (
            <SignInButton mode="modal" fallbackRedirectUrl="/student">
              <button className={styles.signInButton} type="button">
                登录学生账号
              </button>
            </SignInButton>
          ) : code === "USER_NOT_PROVISIONED" ? (
            <SignOutButton redirectUrl="/student">
              <button className={styles.signInButton} type="button">
                退出当前账号
              </button>
            </SignOutButton>
          ) : null}
          <Link href="/">返回工作台</Link>
        </div>
      </section>
    </WorkspaceShell>
  );
}

type StudentRelease = StudentReleaseList["releases"][number];
type ReleaseGroupKey = "pending" | "submitted" | "feedback" | "resubmit" | "evaluation" | "history";

const groupDetails = {
  pending: {
    number: "01",
    title: "待提交",
    detail: "尚未形成正式修订，或仍有未提交的工作草稿。",
  },
  submitted: {
    number: "02",
    title: "已提交",
    detail: "当前正式版已经提交，等待教师反馈。",
  },
  feedback: {
    number: "03",
    title: "已有反馈",
    detail: "当前正式修订已有教师反馈，可进入活动查看。",
  },
  resubmit: {
    number: "04",
    title: "待重交",
    detail: "教师要求按反馈修改并重交，当前还没有新的工作草稿。",
  },
  evaluation: {
    number: "05",
    title: "已有评价",
    detail: "当前正式修订已有教师确认的量规评价。",
  },
  history: {
    number: "06",
    title: "历史与关闭",
    detail: "保留读取权限，但当前不能继续保存或提交。",
  },
} satisfies Record<
  ReleaseGroupKey,
  { number: string; title: string; detail: string }
>;

function groupRelease(release: StudentRelease): ReleaseGroupKey {
  if (!release.access.canWrite) {
    return "history";
  }
  if (release.submission.followUp === "AWAITING_RESUBMISSION") {
    return "resubmit";
  }
  if (release.submission.hasWorkingCopy) {
    return "pending";
  }
  if (release.submission.hasCurrentEvaluation) {
    return "evaluation";
  }
  if (release.submission.hasCurrentFeedback) {
    return "feedback";
  }
  if (release.submission.latestRevisionNumber > 0) {
    return "submitted";
  }
  return "pending";
}

function releaseStatusLabel(release: StudentRelease): string {
  if (release.status === "ARCHIVED") {
    return "已封存";
  }
  if (release.status === "CLOSED") {
    return "已关闭";
  }
  if (!release.access.canWrite) {
    return "历史唯读";
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
      ? `正式修订 ${release.submission.latestRevisionNumber} 版`
      : "尚无正式修订",
    release.submission.hasWorkingCopy ? "有未提交草稿" : null,
    release.submission.followUp === "AWAITING_RESUBMISSION" ? "待重交" : null,
    release.submission.followUp === "RESUBMISSION_IN_PROGRESS" ? "重交中" : null,
    release.submission.hasCurrentFeedback ? "当前版已有反馈" : null,
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
      return <AccessUnavailable code={error.code} />;
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
    pending: [] as StudentRelease[],
    submitted: [] as StudentRelease[],
    feedback: [] as StudentRelease[],
    resubmit: [] as StudentRelease[],
    evaluation: [] as StudentRelease[],
    history: [] as StudentRelease[],
  };
  for (const release of releaseList.releases) {
    grouped[groupRelease(release)].push(release);
  }
  const writableCount = releaseList.releases.filter(
    (release) => release.access.canWrite,
  ).length;

  return (
    <WorkspaceShell
      audience="学生"
      actorName={releaseList.actor.displayName}
      navigation={studentNavigation}
    >
      <div className={styles.dashboardMain}>
        <header className={styles.dashboardHeader}>
          <div>
            <p className={styles.eyebrow}>学生工作区 / 学习活动</p>
            <h1>我的学习活动</h1>
            <p>只显示你当前可参与或依法保留读取权限的发布活动。</p>
          </div>
          <dl className={styles.summaryLine}>
            <div>
              <dt>开放可写</dt>
              <dd>{writableCount}</dd>
            </div>
            <div>
              <dt>待提交</dt>
              <dd>{grouped.pending.length}</dd>
            </div>
            <div>
              <dt>已有反馈</dt>
              <dd>{grouped.feedback.length}</dd>
            </div>
            <div>
              <dt>待重交</dt>
              <dd>{grouped.resubmit.length}</dd>
            </div>
            <div>
              <dt>已有评价</dt>
              <dd>{grouped.evaluation.length}</dd>
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
