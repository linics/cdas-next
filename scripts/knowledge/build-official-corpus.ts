import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  disciplineCodeSchema,
  schoolStages,
} from "../../src/domain/activity/activity-content";

const sourceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sources: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/),
            file: z.string().regex(/^[a-z0-9-]+\.md$/),
            title: z.string().trim().min(1),
            publisher: z.string().trim().min(1),
            version: z.string().trim().min(1),
            schoolStages: z.array(z.enum(schoolStages)).min(1),
            disciplineCodes: z.array(disciplineCodeSchema),
            includedTopLevelHeadings: z.array(z.string().trim().min(1)).min(1),
            sourceUrl: z.url().startsWith("https://www.moe.gov.cn/"),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type SourceManifest = z.infer<typeof sourceManifestSchema>["sources"][number];

const repositoryRoot = process.cwd();
const corpusDirectory = join(repositoryRoot, "corpus", "official-standards");
const manifestPath = join(corpusDirectory, "manifest.json");
const generatedPath = join(
  repositoryRoot,
  "src",
  "server",
  "knowledge",
  "generated",
  "official-standards.json",
);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stripInlineMarkup(value: string): string {
  return value
    .replace(/<span\b[^>]*><\/span>/giu, "")
    .replace(/<img\b[^>]*>/giu, "")
    .replace(/<\/?(?:table|thead|tbody|tfoot|tr|td|th|colgroup|col|blockquote|p)\b[^>]*>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\*\*|__|~~|`/gu, "")
    .replace(/\\([.()])/gu, "$1")
    .replace(/^\s*>\s?/gu, "")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function headingLevel(_rawLine: string, cleanLine: string): number | null {
  if (!cleanLine || cleanLine.length > 90) return null;
  if (/^附录\s*\d*/u.test(cleanLine)) return 1;
  if (/^[一二三四五六七八九十]+\s*[、.．]\s*\S/u.test(cleanLine)) return 1;
  if (/^[（(]\s*[一二三四五六七八九十]+\s*[）)]\s*\S/u.test(cleanLine)) return 2;
  if (
    /^(?:【[^】]+】|第[一二三四五六七八九十]+学段|小学部分|初中部分)/u.test(
      cleanLine,
    )
  ) {
    return 4;
  }
  return null;
}

function isRepeatedPageFurniture(value: string, source: SourceManifest): boolean {
  const compact = value.replace(/\s+/gu, "");
  const titleCompact = source.title.replace(/[（）()\s]/gu, "");
  return (
    compact === "义务教育" ||
    compact === "目录" ||
    compact === "前言" ||
    compact === titleCompact ||
    /^(?:(?:I|V|X|Ⅰ|Ⅱ|Ⅲ|Ⅳ|Ⅴ|Ⅵ|Ⅶ|Ⅷ|Ⅸ|Ⅹ)+[.．、]?)?(?:义务教育)?(?:课程方案|语文|数学|物理|信息科技)课程?标准?\(?2022年版\)?$/iu.test(
      compact,
    ) ||
    /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/u.test(compact)
  );
}

function markdownBodyLines(
  markdown: string,
  source: SourceManifest,
): string[] {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const removed = new Set<number>();
  let sawContents = false;
  let startedBody = false;
  let bodyStartIndex = 0;
  let currentTopLevel: string | null = null;

  for (const [index, rawLine] of lines.entries()) {
    const cleanLine = stripInlineMarkup(rawLine);
    const level = headingLevel(rawLine, cleanLine);
    if (!startedBody) {
      if (cleanLine.replace(/\s+/gu, "") === "目录") {
        sawContents = true;
        continue;
      }
      if (
        sawContents &&
        level === 1 &&
        !rawLine.includes("](") &&
        !rawLine.includes("#bookmark")
      ) {
        startedBody = true;
        bodyStartIndex = index;
        currentTopLevel = cleanLine;
      }
      continue;
    }

    const isRepeatedTopLevel =
      level === 1 &&
      cleanLine === currentTopLevel &&
      !rawLine.includes('class="anchor"');
    if (isRepeatedPageFurniture(cleanLine, source) || isRepeatedTopLevel) {
      removed.add(index);
      continue;
    }
    if (level === 1) {
      currentTopLevel = cleanLine;
    }
  }

  // Pandoc preserves the blank lines around Word page headers. Remove those
  // together with the header so a sentence split by a physical page remains
  // one paragraph in the retrieval corpus.
  for (const index of [...removed]) {
    for (let cursor = index - 1; cursor >= 0 && !lines[cursor]?.trim(); cursor -= 1) {
      removed.add(cursor);
    }
    for (let cursor = index + 1; cursor < lines.length && !lines[cursor]?.trim(); cursor += 1) {
      removed.add(cursor);
    }
  }

  return lines
    .slice(bodyStartIndex)
    .filter((_, index) => !removed.has(index + bodyStartIndex));
}

function splitLongParagraph(value: string): string[] {
  if (value.length <= 1_200) return [value];
  const sentences = value.split(/(?<=[。！？；])/u).filter(Boolean);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > 900) {
      parts.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.length > 0 ? parts : [value.slice(0, 1_200), value.slice(1_200)];
}

function markdownBlocks(
  markdown: string,
  source: SourceManifest,
): Array<{ headingPath: string[]; text: string }> {
  const blocks: Array<{ headingPath: string[]; text: string }> = [];
  const headingPath: string[] = [];
  const includedHeadings = new Set(
    source.includedTopLevelHeadings.map((heading) =>
      heading.replace(/\s+/gu, ""),
    ),
  );
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    const text = paragraphLines.map(stripInlineMarkup).join("");
    paragraphLines = [];
    if (text.length < 8 || isRepeatedPageFurniture(text, source)) return;
    if (
      !headingPath[0] ||
      !includedHeadings.has(headingPath[0].replace(/\s+/gu, ""))
    ) {
      return;
    }
    for (const part of splitLongParagraph(text)) {
      if (part.length >= 8) {
        blocks.push({ headingPath: [...headingPath], text: part });
      }
    }
  };

  for (const rawLine of markdownBodyLines(markdown, source)) {
    const cleanLine = stripInlineMarkup(rawLine);
    const level = headingLevel(rawLine, cleanLine);
    if (level !== null && !isRepeatedPageFurniture(cleanLine, source)) {
      flushParagraph();
      headingPath.splice(level - 1);
      headingPath[level - 1] = cleanLine;
      continue;
    }
    if (!cleanLine) {
      flushParagraph();
      continue;
    }
    paragraphLines.push(rawLine);
  }
  flushParagraph();
  return blocks;
}

function buildSections(markdown: string, source: SourceManifest) {
  const blocks = markdownBlocks(markdown, source);
  const sections: Array<{
    id: string;
    headingPath: string[];
    locator: string;
    content: string;
    contentHash: string;
  }> = [];
  const seenContent = new Set<string>();
  let current: typeof blocks = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    const content = current.map((block) => block.text).join("\n\n").trim();
    const headingPath = current[0]?.headingPath.filter(Boolean) ?? [];
    current = [];
    currentLength = 0;
    if (content.length < 80) return;
    const contentHash = sha256(content);
    if (seenContent.has(contentHash)) return;
    seenContent.add(contentHash);
    const locator = headingPath.length > 0 ? headingPath.join(" > ") : "正文";
    sections.push({
      id: `${source.id}-${sha256(`${locator}\n${content}`).slice(0, 12)}`,
      headingPath,
      locator,
      content,
      contentHash,
    });
  };

  for (const block of blocks) {
    const headingChanged =
      current.length > 0 &&
      current[0]?.headingPath.join("\u0000") !== block.headingPath.join("\u0000");
    if ((headingChanged && currentLength >= 220) || currentLength + block.text.length > 1_500) {
      const overlap = current.at(-1);
      flush();
      if (!headingChanged && overlap && overlap.text.length <= 360) {
        current = [overlap];
        currentLength = overlap.text.length;
      }
    }
    current.push(block);
    currentLength += block.text.length + 2;
  }
  flush();
  return sections;
}

async function buildCorpus() {
  const manifest = sourceManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const sources = [];
  for (const source of manifest.sources) {
    const markdown = (await readFile(join(corpusDirectory, source.file), "utf8"))
      .normalize("NFC")
      .replace(/\r\n?/gu, "\n");
    const sections = buildSections(markdown, source);
    if (sections.length < 3) {
      throw new Error(`KNOWLEDGE_SOURCE_TOO_SMALL:${source.id}`);
    }
    sources.push({
      ...source,
      sourceHash: sha256(markdown),
      sections,
    });
  }
  return `${JSON.stringify({ schemaVersion: 1, sources }, null, 2)}\n`;
}

const expected = await buildCorpus();
if (process.argv.includes("--check")) {
  const actual = await readFile(generatedPath, "utf8").catch(() => "");
  if (actual !== expected) {
    throw new Error("OFFICIAL_KNOWLEDGE_CORPUS_OUT_OF_DATE");
  }
  process.stdout.write("Official knowledge corpus is current.\n");
} else {
  await writeFile(generatedPath, expected, "utf8");
  process.stdout.write(`Wrote ${generatedPath}\n`);
}
