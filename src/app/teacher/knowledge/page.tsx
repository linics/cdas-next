import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";
import {
  getOfficialKnowledgeReference,
  listOfficialKnowledgeSources,
  officialKnowledgeDisciplineLabel,
  searchOfficialKnowledge,
} from "../../../server/knowledge/official-corpus";
import {
  getTeacherIdentity,
  TeacherActivityQueryError,
} from "../../../server/queries/teacher-activity-workspace";
import {
  TeacherAccessGate,
  TeacherPage,
  teacherHomeCrumb,
} from "../_components/teacher-shell";
import { ExternalLinkIcon, SearchIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { PageHeader } from "../../_components/page-header";
import { EmptyState } from "../../_components/ui";

type KnowledgeSearchParams = Promise<{
  q?: string | string[];
  source?: string | string[];
  section?: string | string[];
}>;

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function TeacherKnowledgePage({
  searchParams,
}: {
  searchParams?: KnowledgeSearchParams;
}) {
  let actor;
  try {
    const context = await createUiCommandContext();
    actor = await getTeacherIdentity(getDatabaseClient(), context, {});
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <TeacherAccessGate code={error.code} returnPath="/teacher/knowledge" />;
    }
    if (error instanceof TeacherActivityQueryError || error instanceof ZodError) {
      notFound();
    }
    throw error;
  }

  const values = (await searchParams) ?? {};
  const query = one(values.q).trim().slice(0, 400);
  const sourceId = one(values.source);
  const sectionId = one(values.section);
  const selected =
    sourceId && sectionId
      ? getOfficialKnowledgeReference(sourceId, sectionId)
      : null;
  const search = query
    ? searchOfficialKnowledge({ query, limit: 8 })
    : null;
  const sources = listOfficialKnowledgeSources();

  return (
    <TeacherPage
      actorName={actor.displayName}
      breadcrumb={[teacherHomeCrumb, { label: "课程依据" }]}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          actions={
            <Button asChild variant="outline">
              <Link href="/teacher/activities">返回活动设计</Link>
            </Button>
          }
          description="收录教育部 2022 年版课程方案与 14 门课程标准，供设计活动时查证依据；检索结果不构成合规判定。综合实践活动暂无独立课标语料。"
          title="检索课程标准"
        />

        <Card>
          <CardContent>
            <form action="/teacher/knowledge" className="flex flex-col gap-2" method="get">
              <label className="text-sm font-medium" htmlFor="knowledge-query">
                关键词或设计问题
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    defaultValue={query}
                    id="knowledge-query"
                    maxLength={400}
                    name="q"
                    placeholder="例如：七至九年级 数据分析 跨学科实践 评价"
                  />
                </div>
                <Button type="submit">检索官方标准</Button>
              </div>
              <p className="type-caption">检索基于官方文本原文，不依赖 AI。</p>
            </form>
          </CardContent>
        </Card>

        {sourceId && sectionId ? (
          selected ? (
            <Card id="selected-source">
              <CardHeader>
                <CardDescription>
                  {selected.publisher} · {selected.version}
                </CardDescription>
                <CardTitle className="type-card-title">
                  {selected.citationLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="type-body whitespace-pre-wrap">
                {selected.content}
              </CardContent>
              <CardFooter>
                <Button asChild size="sm" variant="outline">
                  <a href={selected.sourceUrl}>
                    <ExternalLinkIcon />
                    在教育部发布页核对原始文件
                  </a>
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <EmptyState title="没有这个章节">
              该章节不在当前收录范围内。
            </EmptyState>
          )
        ) : null}

        {search ? (
          <section aria-labelledby="search-results-title" className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div className="space-y-1">
                <p className="type-caption">检索结果</p>
                <h2 className="type-section-title" id="search-results-title">
                  “{query}”的结果
                </h2>
              </div>
              <Badge variant="secondary">{`${search.results.length} 条`}</Badge>
            </div>
            {search.status === "FOUND" ? (
              <ol className="flex flex-col gap-3">
                {search.results.map((result) => (
                  <li key={result.sectionId}>
                    <Card size="sm">
                      <CardHeader>
                        <CardTitle className="type-card-title">
                          <Link
                            className="underline-offset-4 hover:underline"
                            href={result.href}
                          >
                            {result.citationLabel}
                          </Link>
                        </CardTitle>
                        <CardDescription className="type-body">
                          {result.excerpt}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="没有找到匹配内容">
                请尝试使用「课程目标」「学业质量」「跨学科实践」等课标术语重新检索。
              </EmptyState>
            )}
          </section>
        ) : (
          <section aria-labelledby="corpus-sources-title" className="flex flex-col gap-3">
            <div className="space-y-1">
              <p className="type-caption">收录范围</p>
              <h2 className="type-section-title" id="corpus-sources-title">
                已收录的官方来源
              </h2>
            </div>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {sources.map((source) => (
                <li key={source.id}>
                  <Card className="h-full" size="sm">
                    <CardHeader>
                      <CardTitle className="type-card-title">{source.title}</CardTitle>
                      <CardDescription>
                        {source.publisher} · {source.version}
                      </CardDescription>
                      <CardAction>
                        <Badge variant="secondary">{`${source.sectionCount} 个章节`}</Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-wrap items-end justify-between gap-2">
                      <p className="type-caption">
                        {source.disciplineCodes.length > 0
                          ? source.disciplineCodes
                              .map(officialKnowledgeDisciplineLabel)
                              .join("、")
                          : "所有学科通用课程方案"}
                      </p>
                      <a
                        className="inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                        href={source.sourceUrl}
                      >
                        教育部发布页
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </TeacherPage>
  );
}
