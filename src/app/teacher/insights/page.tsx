import Link from "next/link";
import { notFound } from "next/navigation";
import { z, ZodError } from "zod";
import { INSIGHTS_MIN_SAMPLE } from "../../../domain/insights/teacher-insights";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import { TeacherActivityQueryError } from "../../../server/queries/teacher-activity-workspace";
import {
  getTeacherInsights,
  type TeacherInsightsDashboard,
} from "../../../server/queries/teacher-insights";
import { WorkspaceRoleGate } from "../../_components/workspace-shell";
import {
  TeacherAccessGate,
  TeacherPage,
  teacherHomeCrumb,
} from "../_components/teacher-shell";
import workspaceStyles from "../teacher-workspace.module.css";
import styles from "./insights.module.css";

type InsightsSearchParams = Promise<{
  release?: string | string[];
}>;

const LEVEL_SEGMENTS = [
  ["excellent", "优秀"],
  ["good", "良好"],
  ["pass", "合格"],
  ["improve", "需改进"],
  ["insufficient", "证据不足"],
] as const;

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function ratioLabel(part: number, total: number): string | null {
  if (total < INSIGHTS_MIN_SAMPLE) {
    return null;
  }
  return `${Math.round((part / total) * 100)}%`;
}

function StackedBar({
  total,
  segments,
  tone = "level",
}: {
  total: number;
  segments: ReadonlyArray<{ key: string; label: string; count: number; tone: string }>;
  tone?: "level" | "stage";
}) {
  if (total <= 0) {
    return <div className={styles.barTrack} aria-hidden="true" />;
  }
  return (
    <div
      className={styles.barTrack}
      role="img"
      aria-label={segments
        .map((segment) => `${segment.label} ${segment.count}`)
        .join("，")}
    >
      {segments.map((segment) => {
        if (segment.count <= 0) {
          return null;
        }
        const width = (segment.count / total) * 100;
        return (
          <span
            className={styles.barFill}
            data-tone={tone === "stage" ? "stage" : segment.tone}
            key={segment.key}
            style={{ width: `${width}%` }}
          >
            {segment.count}
          </span>
        );
      })}
    </div>
  );
}

function RubricCard({
  card,
}: {
  card: TeacherInsightsDashboard["rubric"][number];
}) {
  if (card.status === "no_rubric") {
    return (
      <article className={styles.releaseBlock}>
        <h3>{card.title}</h3>
        <p>{card.classroomName} · 无量规</p>
        <p className={workspaceStyles.emptyState}>
          该发布使用旧版任务书，无量规，不参与统计。
        </p>
      </article>
    );
  }
  if (card.status === "no_evaluations") {
    return (
      <article className={styles.releaseBlock}>
        <h3>{card.title}</h3>
        <p>{card.classroomName}</p>
        <p className={workspaceStyles.emptyState}>
          暂无已确认的量规评价；确认评价后会显示各维度档位分布。
        </p>
      </article>
    );
  }
  return (
    <article className={styles.releaseBlock}>
      <h3>{card.title}</h3>
      <p>
        {card.classroomName} · {card.sampleCount} 份当前正式修订已评价
      </p>
      <ul className={styles.dimensionList}>
        {card.dimensions.map((dimension) => (
          <li className={styles.dimensionRow} key={dimension.dimensionIndex}>
            <div className={styles.dimensionHead}>
              <strong>
                {dimension.dimensionIndex}. {dimension.dimensionName}
              </strong>
              {dimension.weak ? <span className={styles.weakMark}>薄弱维度</span> : null}
            </div>
            <StackedBar
              total={card.sampleCount}
              segments={LEVEL_SEGMENTS.map(([key, label]) => ({
                key,
                label,
                tone: key,
                count: dimension[key],
              }))}
            />
            <p className={styles.legend}>
              {LEVEL_SEGMENTS.map(([key, label]) => (
                <span key={key}>
                  {label} {dimension[key]}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}

function StageCard({
  card,
}: {
  card: TeacherInsightsDashboard["stages"][number];
}) {
  if (card.audienceCount === 0) {
    return (
      <article className={styles.releaseBlock}>
        <h3>{card.title}</h3>
        <p>{card.classroomName}</p>
        <p className={workspaceStyles.emptyState}>
          当前班级暂无可统计的学生或小组。
        </p>
      </article>
    );
  }
  return (
    <article className={styles.releaseBlock}>
      <h3>{card.title}</h3>
      <p>
        {card.classroomName} · {card.audienceCount} 个学生或小组
      </p>
      <ul className={styles.stageList}>
        {card.buckets.map((bucket) => (
          <li className={styles.stageRow} key={bucket.key}>
            <div className={styles.stageHead}>
              <strong>{bucket.label}</strong>
              <span>
                {bucket.count}
                {ratioLabel(bucket.count, card.audienceCount)
                  ? ` · ${ratioLabel(bucket.count, card.audienceCount)}`
                  : ""}
              </span>
            </div>
            <StackedBar
              tone="stage"
              total={card.audienceCount}
              segments={[
                {
                  key: bucket.key,
                  label: bucket.label,
                  tone: "stage",
                  count: bucket.count,
                },
              ]}
            />
          </li>
        ))}
      </ul>
    </article>
  );
}

function ImprovementCard({
  improvement,
  hasReleases,
}: {
  improvement: TeacherInsightsDashboard["improvement"];
  hasReleases: boolean;
}) {
  if (!hasReleases) {
    return null;
  }
  if (improvement.reviseCount === 0) {
    return (
      <p className={workspaceStyles.emptyState}>
        暂无要求重交的反馈，暂不统计重交率与评价变化。
      </p>
    );
  }
  const resubmitRatio = ratioLabel(
    improvement.resubmittedCount,
    improvement.reviseCount,
  );
  const movementTotal =
    improvement.rose + improvement.unchanged + improvement.fell;
  const movementTooSmall =
    improvement.evaluationPairs < INSIGHTS_MIN_SAMPLE;
  return (
    <>
      {improvement.reviseCount < INSIGHTS_MIN_SAMPLE ? (
        <p className={styles.sampleNote}>样本不足，暂不统计百分比。</p>
      ) : null}
      <dl className={styles.statGrid}>
        <div>
          <dt>要求重交</dt>
          <dd>{improvement.reviseCount}</dd>
        </div>
        <div>
          <dt>已重交</dt>
          <dd>
            {improvement.resubmittedCount}
            {resubmitRatio ? ` · ${resubmitRatio}` : ""}
          </dd>
        </div>
        <div>
          <dt>成对评价</dt>
          <dd>{improvement.evaluationPairs}</dd>
        </div>
      </dl>
      {improvement.evaluationPairs === 0 ? (
        <p className={workspaceStyles.emptyState}>
          已有重交，但重交前后尚无量规评价，暂无法比较档位变化。
        </p>
      ) : (
        <>
          {movementTooSmall ? (
            <p className={styles.sampleNote}>
              评价变化样本不足，暂不统计百分比。
            </p>
          ) : null}
          <p className={styles.legend}>
            <span>上升 {improvement.rose}{ratioLabel(improvement.rose, movementTotal) ? ` · ${ratioLabel(improvement.rose, movementTotal)}` : ""}</span>
            <span>持平 {improvement.unchanged}{ratioLabel(improvement.unchanged, movementTotal) ? ` · ${ratioLabel(improvement.unchanged, movementTotal)}` : ""}</span>
            <span>下降 {improvement.fell}{ratioLabel(improvement.fell, movementTotal) ? ` · ${ratioLabel(improvement.fell, movementTotal)}` : ""}</span>
          </p>
        </>
      )}
    </>
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
  try {
    const context = await createUiCommandContext();
    dashboard = await getTeacherInsights(getDatabaseClient(), context, {
      ...(requestedReleaseId.success
        ? { releaseId: requestedReleaseId.data }
        : {}),
    });
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

  const hasReleases = dashboard.releaseOptions.length > 0;

  return (
    <TeacherPage
      actorName={dashboard.actor.displayName}
      breadcrumb={[teacherHomeCrumb, { label: "过程诊断" }]}
    >
      <div className={workspaceStyles.pageContent}>
        <header className={workspaceStyles.pageHeader}>
          <div>
            <p className={workspaceStyles.eyebrow}>教师工作台 / 过程诊断</p>
            <h1>阶段进度、量规表现与重交改善</h1>
            <p>
              汇总你可查看的各次发布，统计基于正式提交与已确认的反馈、评价。
            </p>
          </div>
          <Link className={workspaceStyles.secondaryButton} href="/teacher">
            返回工作台
          </Link>
        </header>

        <div className={styles.insightsLayout}>
          {hasReleases ? (
            <form
              action="/teacher/insights"
              className={styles.filterForm}
              method="get"
            >
              <label htmlFor="insights-release">查看范围</label>
              <div>
                <select
                  defaultValue={dashboard.selectedReleaseId ?? ""}
                  id="insights-release"
                  name="release"
                >
                  <option value="">全部可查看的发布</option>
                  {dashboard.releaseOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title} · {option.classroomName}
                    </option>
                  ))}
                </select>
                <button type="submit">筛选</button>
              </div>
              <small>各次发布的量规分别统计。</small>
            </form>
          ) : (
            <p className={workspaceStyles.emptyState}>
              暂无可查看的发布。发布活动并保持班级管理权后，这里会出现过程诊断。
            </p>
          )}

          <section className={styles.card}>
            <p className={workspaceStyles.eyebrow}>量规诊断</p>
            <h2>量规薄弱项</h2>
            <p className={styles.cardLead}>
              统计各次发布最新一份已确认评价；「需改进」占比最高的维度标记为薄弱项。
            </p>
            {hasReleases
              ? dashboard.rubric.map((card) => (
                  <RubricCard card={card} key={card.releaseId} />
                ))
              : null}
          </section>

          <section className={styles.card}>
            <p className={workspaceStyles.eyebrow}>阶段进度</p>
            <h2>阶段卡点</h2>
            <p className={styles.cardLead}>
              小组按组统计，未分组学生按人统计；要求重交不会使学生退回上一阶段。
            </p>
            {hasReleases
              ? dashboard.stages.map((card) => (
                  <StageCard card={card} key={card.releaseId} />
                ))
              : null}
          </section>

          <section className={styles.card}>
            <p className={workspaceStyles.eyebrow}>重交与改善</p>
            <h2>反馈后改善</h2>
            <p className={styles.cardLead}>
              重交率统计被要求重交后完成重新提交的比例；评价变化仅比较重交前后均有量规评价的样本。
            </p>
            <ImprovementCard
              hasReleases={hasReleases}
              improvement={dashboard.improvement}
            />
          </section>
        </div>
      </div>
    </TeacherPage>
  );
}
