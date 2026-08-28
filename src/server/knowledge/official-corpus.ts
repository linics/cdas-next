import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  disciplineCatalog,
  disciplineCodeSchema,
  schoolStages,
  type DisciplineCode,
  type SchoolStage,
} from "../../domain/activity/activity-content";
import corpusJson from "./generated/official-standards.json";

const sourceIdSchema = z.string().regex(/^[a-z0-9-]{3,80}$/);
const sectionIdSchema = z.string().regex(/^[a-z0-9-]{8,120}$/);

const corpusSectionSchema = z
  .object({
    id: sectionIdSchema,
    headingPath: z.array(z.string().trim().min(1)).max(8),
    locator: z.string().trim().min(1).max(500),
    content: z.string().trim().min(80).max(2_000),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const corpusSourceSchema = z
  .object({
    id: sourceIdSchema,
    file: z.string().regex(/^[a-z0-9-]+\.md$/),
    title: z.string().trim().min(1).max(200),
    publisher: z.literal("中华人民共和国教育部"),
    version: z.literal("2022年版"),
    schoolStages: z.array(z.enum(schoolStages)).min(1),
    disciplineCodes: z.array(disciplineCodeSchema),
    includedTopLevelHeadings: z.array(z.string().trim().min(1)).min(1),
    sourceUrl: z.url().startsWith("https://www.moe.gov.cn/"),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    sections: z.array(corpusSectionSchema).min(3),
  })
  .strict();

const corpusSchema = z
  .object({
    schemaVersion: z.literal(1),
    sources: z.array(corpusSourceSchema).min(1),
  })
  .strict();

const corpus = corpusSchema.parse(corpusJson);
type CorpusSource = z.infer<typeof corpusSourceSchema>;
type CorpusSection = z.infer<typeof corpusSectionSchema>;

const sectionById = new Map<string, { source: CorpusSource; section: CorpusSection }>();
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

for (const source of corpus.sources) {
  for (const section of source.sections) {
    if (sha256(section.content) !== section.contentHash) {
      throw new Error(`INVALID_OFFICIAL_KNOWLEDGE_HASH:${section.id}`);
    }
    if (sectionById.has(section.id)) {
      throw new Error(`DUPLICATE_OFFICIAL_KNOWLEDGE_SECTION:${section.id}`);
    }
    sectionById.set(section.id, { source, section });
  }
}

const traditionalToSimplified: Readonly<Record<string, string>> = {
  課: "课",
  程: "程",
  標: "标",
  準: "准",
  學: "学",
  習: "习",
  語: "语",
  數: "数",
  資: "资",
  訊: "讯",
  科: "科",
  技: "技",
  物: "物",
  理: "理",
  評: "评",
  價: "价",
  證: "证",
  據: "据",
  設: "设",
  計: "计",
  質: "质",
  規: "规",
  實: "实",
  踐: "践",
  綜: "综",
  與: "与",
  專: "专",
  題: "题",
  動: "动",
  圖: "图",
  寫: "写",
  讀: "读",
  調: "调",
  查: "查",
  過: "过",
  結: "结",
  構: "构",
  應: "应",
  用: "用",
  網: "网",
  絡: "络",
  體: "体",
};

function canonicalText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[課程標準學習語數資訊科技物理評價證據設計質規實踐綜與專題動圖寫讀調查過結構應用網絡體]/gu, (character) =>
      traditionalToSimplified[character] ?? character,
    )
    .toLowerCase();
}

const wordSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const FIELD_WEIGHTS = { title: 4, locator: 2.5, content: 1 } as const;

function addToken(counts: Map<string, number>, token: string) {
  if (!token) return;
  counts.set(token, (counts.get(token) ?? 0) + 1);
}

function tokenize(text: string): Map<string, number> {
  const canonical = canonicalText(text);
  const counts = new Map<string, number>();
  for (const segment of wordSegmenter.segment(canonical)) {
    if (!segment.isWordLike) continue;
    const token = segment.segment.trim();
    if (token.length >= 2 || /^[a-z0-9]+$/u.test(token)) addToken(counts, token);
  }
  const cjk = canonical.replace(/[^\p{Script=Han}]/gu, "");
  for (let index = 0; index < cjk.length - 1; index += 1) {
    addToken(counts, cjk.slice(index, index + 2));
  }
  return counts;
}

function tokenLength(counts: Map<string, number>): number {
  let length = 0;
  for (const count of counts.values()) length += count;
  return length;
}

function searchTerms(query: string): string[] {
  return [...tokenize(query).keys()].slice(0, 24);
}

type IndexedSection = {
  source: CorpusSource;
  section: CorpusSection;
  title: Map<string, number>;
  locator: Map<string, number>;
  content: Map<string, number>;
  titleLen: number;
  locatorLen: number;
  contentLen: number;
};

const indexedSections: IndexedSection[] = [];
const documentFrequency = new Map<string, number>();

for (const source of corpus.sources) {
  for (const section of source.sections) {
    const title = tokenize(source.title);
    const locator = tokenize(section.locator);
    const content = tokenize(section.content);
    const terms = new Set([...title.keys(), ...locator.keys(), ...content.keys()]);
    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    indexedSections.push({
      source,
      section,
      title,
      locator,
      content,
      titleLen: tokenLength(title),
      locatorLen: tokenLength(locator),
      contentLen: tokenLength(content),
    });
  }
}

const documentCount = indexedSections.length;
const avgTitleLen =
  indexedSections.reduce((sum, item) => sum + item.titleLen, 0) / documentCount;
const avgLocatorLen =
  indexedSections.reduce((sum, item) => sum + item.locatorLen, 0) / documentCount;
const avgContentLen =
  indexedSections.reduce((sum, item) => sum + item.contentLen, 0) / documentCount;

function idf(term: string): number {
  const df = documentFrequency.get(term) ?? 0;
  return Math.log((documentCount - df + 0.5) / (df + 0.5) + 1);
}

function bm25Field(
  tf: number,
  dl: number,
  avgdl: number,
  termIdf: number,
  weight: number,
): number {
  if (tf <= 0 || avgdl <= 0) return 0;
  const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl));
  return (weight * termIdf * (tf * (BM25_K1 + 1))) / denom;
}

export const officialKnowledgeSearchInputSchema = z
  .object({
    query: z.string().trim().min(2).max(400),
    schoolStage: z.enum(schoolStages).optional(),
    disciplineCodes: z.array(disciplineCodeSchema).max(6).optional(),
    limit: z.int().min(1).max(8).default(6),
  })
  .strict();

export type OfficialKnowledgeSearchInput = z.input<
  typeof officialKnowledgeSearchInputSchema
>;

export const officialKnowledgeSearchResultSchema = z
  .object({
    sourceId: sourceIdSchema,
    sectionId: sectionIdSchema,
    sourceTitle: z.string().trim().min(1).max(200),
    locator: z.string().trim().min(1).max(500),
    citationLabel: z.string().trim().min(1).max(700),
    excerpt: z.string().trim().min(1).max(420),
    href: z
      .string()
      .regex(
        /^\/teacher\/knowledge\?source=[a-z0-9-]{3,80}&section=[a-z0-9-]{8,120}$/,
      ),
    sourceUrl: z.url().startsWith("https://www.moe.gov.cn/"),
  })
  .strict();

export const officialKnowledgeSearchOutputSchema = z
  .object({
    status: z.enum(["FOUND", "NO_MATCH"]),
    results: z.array(officialKnowledgeSearchResultSchema).max(8),
  })
  .strict()
  .superRefine((output, context) => {
    if (
      (output.status === "FOUND" && output.results.length === 0) ||
      (output.status === "NO_MATCH" && output.results.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message: "Search status must match result availability",
      });
    }
  });

export type OfficialKnowledgeSearchOutput = z.infer<
  typeof officialKnowledgeSearchOutputSchema
>;

export const officialKnowledgeReadInputSchema = z
  .object({
    sourceId: sourceIdSchema,
    sectionId: sectionIdSchema,
  })
  .strict();

const foundSectionSchema = z
  .object({
    status: z.literal("FOUND"),
    sourceId: sourceIdSchema,
    sectionId: sectionIdSchema,
    sourceTitle: z.string().trim().min(1).max(200),
    publisher: z.literal("中华人民共和国教育部"),
    version: z.literal("2022年版"),
    locator: z.string().trim().min(1).max(500),
    citationLabel: z.string().trim().min(1).max(700),
    content: z.string().trim().min(80).max(2_000),
    href: z
      .string()
      .regex(
        /^\/teacher\/knowledge\?source=[a-z0-9-]{3,80}&section=[a-z0-9-]{8,120}$/,
      ),
    sourceUrl: z.url().startsWith("https://www.moe.gov.cn/"),
  })
  .strict();

const missingSectionSchema = z
  .object({
    status: z.literal("NOT_FOUND"),
    sourceId: sourceIdSchema,
    sectionId: sectionIdSchema,
  })
  .strict();

export const officialKnowledgeReadOutputSchema = z.discriminatedUnion("status", [
  foundSectionSchema,
  missingSectionSchema,
]);

export type OfficialKnowledgeReadOutput = z.infer<
  typeof officialKnowledgeReadOutputSchema
>;

export type OfficialKnowledgeSectionIdentity = Readonly<{
  sourceId: string;
  sectionId: string;
}>;

export function officialKnowledgeSectionKey(
  section: OfficialKnowledgeSectionIdentity,
): string {
  return `${section.sourceId}:${section.sectionId}`;
}

function citationFor(source: CorpusSource, section: CorpusSection) {
  return {
    sourceId: source.id,
    sectionId: section.id,
    sourceTitle: source.title,
    locator: section.locator,
    citationLabel: `《${source.title}》· ${section.locator}`,
    href: `/teacher/knowledge?source=${source.id}&section=${section.id}`,
    sourceUrl: source.sourceUrl,
  } as const;
}

function excerptFor(content: string, terms: string[]): string {
  const canonical = canonicalText(content);
  const positions = terms
    .map((term) => canonical.indexOf(term))
    .filter((position) => position >= 0);
  const first = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, first - 90);
  const end = Math.min(content.length, start + 360);
  return `${start > 0 ? "…" : ""}${content.slice(start, end).trim()}${
    end < content.length ? "…" : ""
  }`;
}

function queryPhrases(query: string): string[] {
  return query
    .split(/\s+/u)
    .map((part) => canonicalText(part))
    .filter((part) => part.length >= 2)
    .slice(0, 8);
}

function phrasePositions(text: string, phrase: string): number[] {
  const haystack = canonicalText(text);
  const positions: number[] = [];
  let from = 0;
  while (from < haystack.length) {
    const found = haystack.indexOf(phrase, from);
    if (found < 0) break;
    positions.push(found);
    from = found + phrase.length;
  }
  return positions;
}

function proximityBoost(content: string, phrases: readonly string[]): number {
  if (phrases.length === 0) return 0;
  if (phrases.length === 1) {
    return canonicalText(content).includes(phrases[0] ?? "") ? 1.5 : 0;
  }
  const positions = phrases.map((phrase) => phrasePositions(content, phrase));
  if (positions.some((list) => list.length === 0)) return 0;
  let minDistance = Number.POSITIVE_INFINITY;
  for (const left of positions[0] ?? []) {
    for (const right of positions[1] ?? []) {
      minDistance = Math.min(minDistance, Math.abs(left - right));
    }
  }
  if (minDistance <= 12) return 10;
  if (minDistance <= 40) return 4;
  return 0.8;
}

function sourceSupportsFilters(
  source: CorpusSource,
  schoolStage: SchoolStage | undefined,
  disciplines: readonly DisciplineCode[],
): boolean {
  if (schoolStage && !source.schoolStages.includes(schoolStage)) return false;
  return (
    disciplines.length === 0 ||
    source.disciplineCodes.length === 0 ||
    source.disciplineCodes.some((code) => disciplines.includes(code))
  );
}

export function searchOfficialKnowledge(
  input: OfficialKnowledgeSearchInput,
): OfficialKnowledgeSearchOutput {
  const parsed = officialKnowledgeSearchInputSchema.parse(input);
  const terms = searchTerms(parsed.query);
  const disciplines = parsed.disciplineCodes ?? [];
  const scored: Array<{
    score: number;
    source: CorpusSource;
    section: CorpusSection;
  }> = [];

  for (const document of indexedSections) {
    if (!sourceSupportsFilters(document.source, parsed.schoolStage, disciplines)) {
      continue;
    }
    const disciplineBonus = document.source.disciplineCodes.some((code) =>
      disciplines.includes(code),
    )
      ? 2
      : 0;
    let score = disciplineBonus;
    let matchedTerms = 0;
    for (const term of terms) {
      const titleTf = document.title.get(term) ?? 0;
      const locatorTf = document.locator.get(term) ?? 0;
      const contentTf = document.content.get(term) ?? 0;
      if (titleTf + locatorTf + contentTf === 0) continue;
      matchedTerms += 1;
      const termIdf = idf(term);
      score += bm25Field(titleTf, document.titleLen, avgTitleLen, termIdf, FIELD_WEIGHTS.title);
      score += bm25Field(
        locatorTf,
        document.locatorLen,
        avgLocatorLen,
        termIdf,
        FIELD_WEIGHTS.locator,
      );
      score += bm25Field(
        contentTf,
        document.contentLen,
        avgContentLen,
        termIdf,
        FIELD_WEIGHTS.content,
      );
    }
    if (terms.length > 0 && matchedTerms === 0) continue;
    score += proximityBoost(document.section.content, queryPhrases(parsed.query));
    if (score > 0) {
      scored.push({ score, source: document.source, section: document.section });
    }
  }

  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.source.id.localeCompare(right.source.id) ||
      left.section.id.localeCompare(right.section.id),
  );

  const selected: typeof scored = [];
  const perSource = new Map<string, number>();
  for (const candidate of scored) {
    if ((perSource.get(candidate.source.id) ?? 0) >= 2) continue;
    selected.push(candidate);
    perSource.set(
      candidate.source.id,
      (perSource.get(candidate.source.id) ?? 0) + 1,
    );
    if (selected.length >= parsed.limit) break;
  }

  const results = selected.map(({ source, section }) => ({
    ...citationFor(source, section),
    excerpt: excerptFor(section.content, terms),
  }));
  return officialKnowledgeSearchOutputSchema.parse({
    status: results.length > 0 ? "FOUND" : "NO_MATCH",
    results,
  });
}

export function readOfficialKnowledgeSection(
  input: z.infer<typeof officialKnowledgeReadInputSchema>,
): OfficialKnowledgeReadOutput {
  const parsed = officialKnowledgeReadInputSchema.parse(input);
  const found = sectionById.get(parsed.sectionId);
  if (!found || found.source.id !== parsed.sourceId) {
    return { status: "NOT_FOUND", ...parsed };
  }
  return officialKnowledgeReadOutputSchema.parse({
    status: "FOUND",
    ...citationFor(found.source, found.section),
    publisher: found.source.publisher,
    version: found.source.version,
    content: found.section.content,
  });
}

export function getOfficialKnowledgeReference(
  sourceId: string,
  sectionId: string,
) {
  const found = sectionById.get(sectionId);
  if (!found || found.source.id !== sourceId) return null;
  return {
    ...citationFor(found.source, found.section),
    publisher: found.source.publisher,
    version: found.source.version,
    content: found.section.content,
    schoolStages: [...found.source.schoolStages],
    disciplineCodes: [...found.source.disciplineCodes],
  };
}

export function listOfficialKnowledgeSources() {
  return corpus.sources.map((source) => ({
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    version: source.version,
    schoolStages: [...source.schoolStages],
    disciplineCodes: [...source.disciplineCodes],
    sourceUrl: source.sourceUrl,
    sourceHash: source.sourceHash,
    sectionCount: source.sections.length,
  }));
}

export function officialKnowledgeDisciplineLabel(code: DisciplineCode): string {
  return disciplineCatalog.find((item) => item.code === code)?.label ?? code;
}
