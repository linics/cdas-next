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

function searchTerms(query: string): string[] {
  const canonical = canonicalText(query);
  const segmented = [...wordSegmenter.segment(canonical)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment.trim())
    .filter((segment) => segment.length >= 2 || /^[a-z0-9]+$/u.test(segment));
  const cjk = canonical.replace(/[^\p{Script=Han}]/gu, "");
  if (segmented.length === 0 && cjk.length >= 2) {
    for (let index = 0; index < cjk.length - 1; index += 1) {
      segmented.push(cjk.slice(index, index + 2));
    }
  }
  return [...new Set(segmented)].slice(0, 24);
}

function occurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let position = 0;
  while (count < 6) {
    const found = haystack.indexOf(needle, position);
    if (found < 0) break;
    count += 1;
    position = found + needle.length;
  }
  return count;
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

export const officialKnowledgeReferenceSchema = z
  .object({
    sourceId: sourceIdSchema,
    sectionId: sectionIdSchema,
    citationLabel: z.string().trim().min(1).max(700),
    href: z
      .string()
      .regex(
        /^\/teacher\/knowledge\?source=[a-z0-9-]{3,80}&section=[a-z0-9-]{8,120}$/,
      ),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

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

  for (const source of corpus.sources) {
    if (!sourceSupportsFilters(source, parsed.schoolStage, disciplines)) continue;
    const sourceTitle = canonicalText(source.title);
    const disciplineBonus = source.disciplineCodes.some((code) =>
      disciplines.includes(code),
    )
      ? 24
      : 0;
    for (const section of source.sections) {
      const locator = canonicalText(section.locator);
      const content = canonicalText(section.content);
      let score = disciplineBonus;
      let matchedTerms = 0;
      for (const term of terms) {
        const titleMatches = occurrences(sourceTitle, term);
        const locatorMatches = occurrences(locator, term);
        const contentMatches = occurrences(content, term);
        if (titleMatches + locatorMatches + contentMatches > 0) matchedTerms += 1;
        score += titleMatches * 18 + locatorMatches * 12 + contentMatches * 2;
      }
      if (terms.length > 0 && matchedTerms === 0) continue;
      score += matchedTerms * 3;
      if (score > 0) scored.push({ score, source, section });
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
