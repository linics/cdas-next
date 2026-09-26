import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { TaskBookV3View } from "../../../_components/task-book-v3-view";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import {
  ActivityCopyError,
  activityCopySourceSchema,
} from "../../../../server/activity/activity-copy-source";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  getActivityCopyPreview,
  getActivityCopySources,
} from "../../../../server/queries/activity-copy-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
  activityStudioCrumb,
  teacherHomeCrumb,
} from "../../_components/teacher-shell";
import { CopyActivityForm } from "./copy-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PageHeader } from "../../../_components/page-header";
import { EmptyState } from "../../../_components/ui";
import { styles } from "../../teacher-ui";

const querySchema = activityCopySourceSchema;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseSourceQuery(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const raw = {
    kind: firstQueryValue(searchParams.kind),
    id: firstQueryValue(searchParams.id),
    version: firstQueryValue(searchParams.version),
  };
  if (!raw.kind && !raw.id && !raw.version) return null;
  const parsed = querySchema.safeParse({
    kind: raw.kind,
    id: raw.id,
    version: raw.version ? Number(raw.version) : raw.version,
  });
  return parsed.success ? parsed.data : "invalid";
}

function sourceHref(source: { kind: "DRAFT" | "RELEASE"; id: string; version: number }) {
  const params = new URLSearchParams({
    kind: source.kind,
    id: source.id,
    version: String(source.version),
  });
  return `/teacher/activities/copy?${params.toString()}`;
}

function copyErrorMessage(error: ActivityCopyError): string {
  return error.code === "STALE_VERSION"
    ? "来源活动已有更新版本，请从列表重新选择。"
    : error.code === "UNSUPPORTED_SCHEMA"
      ? "这份活动使用旧版任务书，不能自动转换；请重新选择 v3 活动。"
      : "当前来源不可访问，请重新选择来源。";
}

export default async function TeacherActivityCopyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseSourceQuery(await searchParams);
  let sources;
  try {
    const context = await createUiCommandContext();
    sources = await getActivityCopySources(getDatabaseClient(), context);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <TeacherAccessGate code={error.code} returnPath="/teacher/activities/copy" />;
    }
    if (error instanceof ActivityCopyError || error instanceof z.ZodError) {
      notFound();
    }
    throw error;
  }

  const selected = query === "invalid" ? null : query;
  let preview: Awaited<ReturnType<typeof getActivityCopyPreview>> | null = null;
  let previewError = query === "invalid" ? "来源参数无效，请重新选择来源。" : "";
  if (selected) {
    try {
      const context = await createUiCommandContext();
      preview = await getActivityCopyPreview(getDatabaseClient(), context, selected);
    } catch (error) {
      if (error instanceof ActivityCopyError) {
        previewError = copyErrorMessage(error);
      } else if (error instanceof AuthenticationError) {
        return <TeacherAccessGate code={error.code} returnPath="/teacher/activities/copy" />;
      } else if (error instanceof z.ZodError) {
        previewError = "来源参数无效，请重新选择来源。";
      } else {
        throw error;
      }
    }
  }

  const sourceRow = (current: boolean) =>
    cn(
      "flex flex-col gap-0.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted/60",
      current && "bg-accent text-accent-foreground hover:bg-accent",
    );

  return (
    <TeacherPage
      actorName={sources.actor.displayName}
      breadcrumb={[teacherHomeCrumb, activityStudioCrumb, { label: "复用活动" }]}
    >
      <div className={styles.pageContent}>
        <PageHeader
          actions={
            <Button asChild variant="outline">
              <Link href="/teacher/activities">返回活动设计</Link>
            </Button>
          }
          description="复制为新草稿，班级、截止时间、提交与反馈不会带过去。"
          title="复用已有活动"
        />

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <Card aria-label="可复用活动来源" className="lg:sticky lg:top-4" role="region">
            <CardHeader>
              <CardTitle className="type-card-title">选择来源</CardTitle>
              <CardDescription>
                本人未封存的 v3 草稿，以及本人仍管理班级的发布快照。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <section className="flex flex-col gap-1">
                <h3 className="type-caption px-3 font-medium">草稿</h3>
                {sources.drafts.length === 0 ? (
                  <p className="px-3 text-sm text-muted-foreground">暂无可复用草稿。</p>
                ) : (
                  sources.drafts.map((source) => {
                    const current =
                      selected?.kind === "DRAFT" &&
                      selected.id === source.id &&
                      selected.version === source.version;
                    return (
                      <Link
                        aria-current={current ? "true" : undefined}
                        className={sourceRow(current)}
                        href={sourceHref({ kind: "DRAFT", ...source })}
                        key={source.id}
                      >
                        <span className="font-medium">{source.title}</span>
                        <span className="type-caption">草稿版本 {source.version}</span>
                      </Link>
                    );
                  })
                )}
              </section>
              <section className="flex flex-col gap-1">
                <h3 className="type-caption px-3 font-medium">已发布快照</h3>
                {sources.releases.length === 0 ? (
                  <p className="px-3 text-sm text-muted-foreground">暂无可复用发布快照。</p>
                ) : (
                  sources.releases.map((source) => {
                    const current =
                      selected?.kind === "RELEASE" &&
                      selected.id === source.id &&
                      selected.version === source.version;
                    return (
                      <Link
                        aria-current={current ? "true" : undefined}
                        className={sourceRow(current)}
                        href={sourceHref({ kind: "RELEASE", id: source.id, version: source.version })}
                        key={source.id}
                      >
                        <span className="font-medium">{source.title}</span>
                        <span className="type-caption tabular-nums">
                          快照 v{source.version} · {source.classroomName} · 发布于{" "}
                          <LocalizedDateTime dateTime={source.publishedAt} />
                        </span>
                      </Link>
                    );
                  })
                )}
              </section>
              <p className="type-caption px-3">旧版任务书不会自动转换。</p>
            </CardContent>
          </Card>

          <section aria-labelledby="copy-preview-title">
            {preview ? (
              <Card>
                <CardHeader>
                  <CardDescription>
                    {preview.source.kind === "DRAFT" ? "草稿来源" : "发布快照来源"} · 版本{" "}
                    {preview.source.version}
                  </CardDescription>
                  <CardTitle className="type-section-title" id="copy-preview-title">
                    {preview.content.title}
                  </CardTitle>
                  <CardDescription>{preview.content.summary}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-6 border-t pt-5 text-sm leading-relaxed [&_section]:flex [&_section]:flex-col [&_section]:gap-2 [&_section_h3]:text-sm [&_section_h3]:font-semibold [&_section_p]:text-muted-foreground [&_ol]:list-decimal [&_ol]:space-y-3 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-3 [&_ul]:pl-5 [&_strong]:font-medium">
                  <TaskBookV3View content={preview.content} />
                </CardContent>
                <CardFooter className="block">
                  <CopyActivityForm
                    key={`${preview.source.kind}:${preview.source.id}:${preview.source.version}`}
                    sourceKind={preview.source.kind}
                    sourceId={preview.source.id}
                    sourceVersion={preview.source.version}
                    initialTitle={preview.content.title}
                    initialIdempotencyKey={`copy_activity_draft_${randomUUID()}`}
                  />
                </CardFooter>
              </Card>
            ) : (
              <EmptyState
                action={
                  previewError ? (
                    <Button asChild variant="outline">
                      <Link href="/teacher/activities/copy">重新选择来源</Link>
                    </Button>
                  ) : undefined
                }
                title="先从左侧选择来源"
              >
                <span id="copy-preview-title" role={previewError ? "alert" : undefined}>
                  {previewError || "选中后会显示完整任务书，确认后只创建新的草稿。"}
                </span>
              </EmptyState>
            )}
          </section>
        </div>
      </div>
    </TeacherPage>
  );
}
