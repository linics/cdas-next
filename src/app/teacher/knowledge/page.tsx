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
import workspaceStyles from "../teacher-workspace.module.css";
import styles from "./knowledge.module.css";

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
      <div className={workspaceStyles.pageContent}>
        <header className={workspaceStyles.pageHeader}>
          <div>
            <p className={workspaceStyles.eyebrow}>活动设计 / 官方依据</p>
            <h1>检索课程标准</h1>
            <p>
              收录教育部 2022 年版课程方案与 14 门学科课程标准，供设计跨学科任务时查证依据；检索结果不构成合规判定。
            </p>
          </div>
          <Link
            className={workspaceStyles.secondaryButton}
            href="/teacher/activities"
          >
            返回活动设计
          </Link>
        </header>

        <main className={styles.knowledgeLayout}>
          <form action="/teacher/knowledge" className={styles.searchForm} method="get">
            <label htmlFor="knowledge-query">关键词或设计问题</label>
            <div>
              <input
                defaultValue={query}
                id="knowledge-query"
                maxLength={400}
                name="q"
                placeholder="例如：七至九年级 数据分析 跨学科实践 评价"
              />
              <button type="submit">检索官方标准</button>
            </div>
            <small>检索基于官方文本原文，不依赖 AI。</small>
          </form>

          {sourceId && sectionId ? (
            selected ? (
              <article className={styles.sourceSection} id="selected-source">
                <p className={styles.sourceMeta}>
                  {selected.publisher} · {selected.version}
                </p>
                <h2>{selected.citationLabel}</h2>
                <p className={styles.sourceContent}>{selected.content}</p>
                <a href={selected.sourceUrl}>在教育部发布页核对原始文件</a>
              </article>
            ) : (
              <p className={styles.emptyResult}>
                该章节不在当前收录范围内。
              </p>
            )
          ) : null}

          {search ? (
            <section className={styles.results} aria-labelledby="search-results-title">
              <header>
                <div>
                  <p className={workspaceStyles.eyebrow}>检索结果</p>
                  <h2 id="search-results-title">“{query}”的结果</h2>
                </div>
                <span>{search.results.length} 条</span>
              </header>
              {search.status === "FOUND" ? (
                <ol>
                  {search.results.map((result) => (
                    <li key={result.sectionId}>
                      <h3>
                        <Link href={result.href}>{result.citationLabel}</Link>
                      </h3>
                      <p>{result.excerpt}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.emptyResult}>
                  没有找到匹配内容。请尝试使用「课程目标」「学业质量」「跨学科实践」等课标术语重新检索。
                </p>
              )}
            </section>
          ) : (
            <section className={styles.results} aria-labelledby="corpus-sources-title">
              <header>
                <div>
                  <p className={workspaceStyles.eyebrow}>收录范围</p>
                  <h2 id="corpus-sources-title">已收录的官方来源</h2>
                </div>
              </header>
              <ul className={styles.sourceList}>
                {sources.map((source) => (
                  <li key={source.id}>
                    <div>
                      <h3>{source.title}</h3>
                      <p>
                        {source.publisher} · {source.version} · {source.sectionCount} 个可检索章节
                      </p>
                      <p>
                        {source.disciplineCodes.length > 0
                          ? source.disciplineCodes
                              .map(officialKnowledgeDisciplineLabel)
                              .join("、")
                          : "所有学科通用课程方案"}
                      </p>
                    </div>
                    <a href={source.sourceUrl}>教育部发布页</a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </TeacherPage>
  );
}
