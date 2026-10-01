import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
vi.mock("server-only", () => ({}));
import {
  answerTextForModel,
  answerThemesModelOutputSchema,
  resolveAnswerThemes,
  type AnswerForThemes,
} from "../../domain/insights/answer-themes";
import { generateReleaseAnswerSummary } from "./release-answer-summary";

/**
 * Only a real call proves DeepSeek quotes the answers verbatim instead of
 * paraphrasing them. Run it several times: one pass is not stability.
 */
const model = () =>
  createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY!.trim(),
  }).chatModel(process.env.AI_MODEL!.trim());

// Planted pattern: almost everyone lists readings; almost nobody computes the
// daily use or says what "wasteful" is compared against.
const texts = [
  "我记录了教学楼二楼饮水机的水表。周一读数 1203.4，周二 1205.1，周三 1207.0。我觉得用水量很大，浪费很严重。",
  "三天的读数分别是 880.2、881.9、883.5。饮水机旁边的水龙头有时候没关紧，会一直滴水。",
  "周一 455.0，周二 456.2，周三 457.9。每天用水量：周一到周二 1.2 吨，周二到周三 1.7 吨。周三比周二多，因为那天有体育课。",
  "读数：周一 1502.3，周二 1504.0，周三 1505.6。同学们接水的时候经常接太满然后倒掉，很浪费。",
  "我们组看的是操场边的水表，周一 77.1，周二 77.9，周三 78.8。水表转得很快，说明浪费很严重。",
  "周一读数 320.5，周二 321.4，周三 322.6。我还拍了照片。洗手池的水龙头是老式的，关不紧。",
  "三天读数：2210.0、2211.3、2212.9。我觉得大家洗拖把的时候用水太多了，应该节约。",
  "周一 640.8，周二 641.7，周三 642.5，平均每天用 0.85 吨。和上学期老师说的每天 0.6 吨相比，多了大约四成。",
];

const answers: AnswerForThemes[] = texts.map((text, index) => ({
  submissionId: `submission-${index + 1}`,
  revisionId: `revision-${index + 1}`,
  text,
}));

describe("real-model answer summary", () => {
  it("returns themes whose quotes are literally in the answers", async () => {
    const raw = await generateReleaseAnswerSummary(model(), {
      task: "饮水区用水记录",
      phase: "实测记录",
      asked: {
        action: "连续三天记录饮水区水表读数，算出每天的用水量，并判断有没有浪费。",
        evidence: ["连续 3 天的水表读数", "每天用水量的计算过程", "判断是否浪费的依据"],
      },
      answers: answers.map((answer, index) => ({
        answer: index + 1,
        text: answerTextForModel(answer.text),
      })),
    });
    const output = answerThemesModelOutputSchema.parse(raw);
    const themes = resolveAnswerThemes(answers, output);
    const offered = output.themes.flatMap((theme) => theme.evidence).length;
    const kept = themes.flatMap((theme) => theme.sources).length;
    if (process.env.ANSWER_SUMMARY_DUMP) {
      writeFileSync(
        `${process.env.ANSWER_SUMMARY_DUMP}/summary-${Date.now()}.json`,
        JSON.stringify({ offered, kept, output, themes }, null, 2),
      );
    }
    expect(output.summary.length).toBeGreaterThan(0);
    // The planted patterns are there, so a useful read finds something.
    expect(themes.length).toBeGreaterThan(0);
    // Most quotes must survive verification; a model that mostly paraphrases
    // would leave the teacher with a thin, unrepresentative summary.
    expect(kept / offered).toBeGreaterThanOrEqual(0.8);
    // The numbering is internal; the teacher never sees it.
    expect(output.summary + JSON.stringify(themes)).not.toMatch(/第\s*\d+(?:\s*[、和]\s*\d+)*\s*份|作答\s*\d+/);
    // Descriptive only: no advice to the teacher.
    expect(JSON.stringify(themes)).not.toMatch(/建议教师|教师应|下节课|应该引导/);
  });
});
