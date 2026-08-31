/**
 * 把代表性问题铺一遍，把答案原样写进报告，供人做开放式编码。
 *
 * 这不是门禁，也不打分：第一遍必须由人读答案、归并出失败分类，再决定哪几类值得
 * 建自动评测。先定指标再去量，得到的是和产品无关的通用指标。
 *
 * 它不带工具。产品问题本来就不该调用工具，而 DELEGATION 那组在无工具下恰好能
 * 暴露一件重要的事：模型是老实说"我需要先查"，还是凭空编出班级名和人数。
 *
 * 用法（需要付费的 DeepSeek key）：
 *   set -a && . ./.env.model-acceptance.local && set +a && \
 *   AI_PROVIDER_DISABLED=0 AI_MODEL=deepseek-v4-flash pnpm eval:assistant-questions
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateText } from "ai";
import { buildActivityAssistantInstructions } from "../../src/server/assistant/activity-assistant-handler";
import { createDeepSeekModel } from "../../src/server/assistant/deepseek-provider";
import { getActivityAssistantConfig } from "../../src/server/assistant/assistant-config";
import { assistantQuestions, type QuestionIntent } from "./assistant-questions";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * 一个有班级的教师比空工作区更接近真实：没有班级时指令会说"不得调用发布工具"，
 * 那会让发布相关的问题得到一个不具代表性的回答。
 */
const classrooms = [
  { id: "c0000000-0000-4000-8000-000000000001", name: "七年一班" },
  { id: "c0000000-0000-4000-8000-000000000002", name: "七年二班" },
];

const intentLabels: Record<QuestionIntent, string> = {
  CAPABILITY: "能不能做",
  WAYFINDING: "在哪做",
  TROUBLESHOOT: "为什么不工作",
  DELEGATION: "帮我做",
  BOUNDARY: "越界请求",
};

async function main(): Promise<void> {
  const config = getActivityAssistantConfig();
  const model = createDeepSeekModel(config);
  const instructions = buildActivityAssistantInstructions(classrooms);
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const directory = path.join(repositoryRoot, "output", "eval", `assistant-questions-${stamp}`);
  await mkdir(directory, { recursive: true });

  const records: Array<Record<string, unknown>> = [];
  let failures = 0;

  for (const [index, question] of assistantQuestions.entries()) {
    process.stdout.write(
      `[${String(index + 1).padStart(2, "0")}/${assistantQuestions.length}] ${question.id} …`,
    );
    let answer = "";
    let error: string | null = null;
    const began = Date.now();
    try {
      const result = await generateText({
        model,
        instructions,
        prompt: question.ask,
        timeout: 60_000,
      });
      answer = result.text.trim();
    } catch (caught) {
      failures += 1;
      error = caught instanceof Error ? caught.message : String(caught);
    }
    process.stdout.write(` ${Date.now() - began}ms\n`);
    records.push({ ...question, answer, error });
  }

  const byIntent = new Map<QuestionIntent, typeof records>();
  for (const record of records) {
    const intent = record.intent as QuestionIntent;
    byIntent.set(intent, [...(byIntent.get(intent) ?? []), record]);
  }

  const report = [
    `# 助手代表性问题 · 回答记录`,
    "",
    `- 时间：${startedAt.toISOString()}`,
    `- 模型：${config.model}`,
    `- 题量：${assistantQuestions.length}（调用失败 ${failures}）`,
    `- 指令长度：${instructions.length} 字符`,
    "",
    `> 这份记录是错误分析的原料。读的时候只记**每条回答里的第一个**问题——`,
    `> 上游一错，下游多半是它的连带反应。读完再归并成分类，不要边读边定指标。`,
    "",
    ...[...byIntent.entries()].flatMap(([intent, group]) => [
      `## ${intentLabels[intent]}（${intent}）`,
      "",
      ...group.flatMap((record) => [
        `### ${record.id} · ${record.surface}`,
        "",
        `**问**：${record.ask}`,
        "",
        `**期望里应当有**：${record.expected}`,
        "",
        record.error
          ? `**调用失败**：\`${record.error}\``
          : `**答**：\n\n${String(record.answer)
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n")}`,
        "",
        `**开放式编码**：`,
        "",
        "---",
        "",
      ]),
    ]),
  ].join("\n");

  await writeFile(path.join(directory, "answers.md"), report, "utf8");
  await writeFile(
    path.join(directory, "answers.json"),
    `${JSON.stringify({ startedAt: startedAt.toISOString(), model: config.model, records }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`\n报告：${directory}/answers.md\n`);
  if (failures > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
