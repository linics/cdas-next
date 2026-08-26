import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  disciplineCodeSchema,
  schoolStages,
} from "../../src/domain/activity/activity-content";
import {
  cleanCurriculumMarkdown,
  curriculumHeadingLevel,
} from "../../src/server/knowledge/clean-curriculum-markdown";

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
const rawDirectory = join(corpusDirectory, "raw");
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
  cleanedMarkdown: string,
  source: SourceManifest,
): Array<{ headingPath: string[]; text: string }> {
  const blocks: Array<{ headingPath: string[]; text: string }> = [];
  const headingPath: string[] = [];
  const includedHeadings = new Set(
    source.includedTopLevelHeadings.map((heading) => heading.replace(/\s+/gu, "")),
  );
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    const text = paragraphLines.join("");
    paragraphLines = [];
    if (text.length < 8) return;
    if (
      !headingPath[0] ||
      !includedHeadings.has(headingPath[0].replace(/\s+/gu, ""))
    ) {
      return;
    }
    for (const part of splitLongParagraph(text)) {
      if (part.length >= 8) {
        blocks.push({ headingPath: [...headingPath].filter(Boolean), text: part });
      }
    }
  };

  for (const line of cleanedMarkdown.split("\n")) {
    const level = curriculumHeadingLevel(line);
    if (level !== null) {
      flushParagraph();
      headingPath.splice(level - 1);
      headingPath[level - 1] = line;
      continue;
    }
    if (!line) {
      flushParagraph();
      continue;
    }
    paragraphLines.push(line);
  }
  flushParagraph();
  return blocks;
}

function buildSections(cleanedMarkdown: string, source: SourceManifest) {
  const blocks = markdownBlocks(cleanedMarkdown, source);
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
    const markdown = (await readFile(join(rawDirectory, source.file), "utf8"))
      .normalize("NFC")
      .replace(/\r\n?/gu, "\n");
    const cleaned = cleanCurriculumMarkdown(markdown);
    const sections = buildSections(cleaned, source);
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
