import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Mechanical Pandoc export of the 2022 Ministry Word originals.
 * It does not edit, summarise, or rewrite curriculum text.
 *
 * Default source directory (outside this repository):
 *   ../cdas/storage/raw/curriculum_standards
 *
 * Usage:
 *   pnpm knowledge:extract
 *   pnpm knowledge:extract -- /absolute/path/to/curriculum_standards
 */

const sources = [
  { file: "01_课程方案.docx", output: "01-course-plan-2022.md" },
  { file: "02_道德与法治.docx", output: "02-politics-standard-2022.md" },
  { file: "03_语文.docx", output: "03-chinese-standard-2022.md" },
  { file: "04_历史.docx", output: "04-history-standard-2022.md" },
  { file: "05_英语.docx", output: "05-english-standard-2022.md" },
  { file: "06_地理.docx", output: "06-geography-standard-2022.md" },
  { file: "07_科学.docx", output: "07-science-standard-2022.md" },
  { file: "08_物理.docx", output: "08-physics-standard-2022.md" },
  { file: "09_生物学.docx", output: "09-biology-standard-2022.md" },
  { file: "10_信息科技.docx", output: "10-info-tech-standard-2022.md" },
  { file: "11_体育与健康.docx", output: "11-sports-standard-2022.md" },
  { file: "12_艺术.docx", output: "12-arts-standard-2022.md" },
  { file: "13_劳动.docx", output: "13-labor-standard-2022.md" },
  { file: "14_数学.docx", output: "14-math-standard-2022.md" },
  { file: "15_化学.docx", output: "15-chemistry-standard-2022.md" },
] as const;

const repositoryRoot = process.cwd();
const defaultSourceDirectory = join(
  repositoryRoot,
  "..",
  "cdas",
  "storage",
  "raw",
  "curriculum_standards",
);
const extraArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const onlyNew = extraArgs.includes("--only-new");
const sourceDirectory =
  extraArgs.find((arg) => !arg.startsWith("--")) ?? defaultSourceDirectory;
const outputDirectory = join(
  repositoryRoot,
  "corpus",
  "official-standards",
  "raw",
);
const existingOnMain = new Set([
  "01-course-plan-2022.md",
  "03-chinese-standard-2022.md",
  "08-physics-standard-2022.md",
  "10-info-tech-standard-2022.md",
  "14-math-standard-2022.md",
]);

function extractOne(inputPath: string): string {
  const result = spawnSync(
    "pandoc",
    ["--track-changes=all", "-t", "gfm", inputPath],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `pandoc failed for ${inputPath}: ${result.stderr || result.error?.message}`,
    );
  }
  const markdown = result.stdout.normalize("NFC").replace(/\r\n?/gu, "\n");
  if (markdown.trim().length < 2_000) {
    throw new Error(`pandoc output looks incomplete: ${inputPath}`);
  }
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

await mkdir(outputDirectory, { recursive: true });
if (!existsSync(sourceDirectory)) {
  throw new Error(`Word source directory not found: ${sourceDirectory}`);
}

for (const source of sources) {
  if (onlyNew && existingOnMain.has(source.output)) continue;
  const inputPath = join(sourceDirectory, source.file);
  if (!existsSync(inputPath)) {
    throw new Error(`Word original not found: ${inputPath}`);
  }
  const markdown = extractOne(inputPath);
  const outputPath = join(outputDirectory, source.output);
  await writeFile(outputPath, markdown, "utf8");
  process.stdout.write(`wrote ${source.output} (${markdown.length} chars)\n`);
}
