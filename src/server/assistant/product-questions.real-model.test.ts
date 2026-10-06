import { describe, expect, it, vi } from "vitest";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
vi.mock("server-only", () => ({}));
import { buildActivityAssistantInstructions } from "./activity-assistant-handler";

/**
 * A teacher asks what the product can do. The unit test proves the instructions
 * carry the answer; only a real model proves the assistant gives it.
 *
 * The failure this guards against is not a refusal to obey — it is a truthful
 * answer about the wrong subject. The assistant reads its own tool list, sees
 * no way to open a submission, and concludes the product cannot help evaluate
 * one. It can: the review workspace drafts feedback and rubric evaluations, and
 * reads the current revision's attachments while doing it.
 *
 * Assertions are on substance, not wording. A refusal cannot accidentally name
 * the page it should have sent the teacher to, so that is what they check.
 */
const model = () =>
  createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY!.trim(),
  }).chatModel(process.env.AI_MODEL!.trim());

type Question = Readonly<{
  name: string;
  ask: string;
  /** Every one of these must appear: the referral is not optional. */
  mustMention: readonly string[];
  /** At least one must appear, when several phrasings are equally right. */
  mustMentionAny?: readonly string[];
  /** None of these may appear: a dead end dressed as an answer. */
  mustNotMention?: readonly string[];
}>;

const questions: readonly Question[] = [
  {
    name: "评判作业与附件",
    ask: "你可以协助我进行学生上交上来的作业的评判吗？包括学生的附件。",
    // The two drafting buttons live on the review page and read the current
    // revision's attachments. An answer that stops at "我读不到" fails here.
    mustMention: ["起草", "评阅"],
    // The teacher must not be told the product cannot do this at all.
    mustNotMention: ["无法评判", "不支持评价", "没有这个功能"],
  },
  {
    // The first error-analysis sweep found this in 6 of 48 answers: the
    // assistant reported its own boundary as the product's. D-054 keeps names
    // out of the model; the teacher's roster page shows them. Telling a teacher
    // to cross-reference a paper list is inventing a problem they do not have.
    name: "名册为什么没有姓名",
    ask: "名册里怎么都是「对象 1」「对象 2」，学生名字呢？",
    mustMention: ["评阅"],
    mustMentionAny: [
      "我这边",
      "我这一侧",
      "我看不到",
      "我能读取",
      "不进模型",
      "我只",
      "对我",
    ],
    mustNotMention: ["线下"],
  },
  {
    name: "加学生进班级",
    ask: "我怎么把学生加到我的班级里？",
    mustMention: ["名单码"],
  },
  {
    name: "AI 会不会自动打分",
    ask: "你会自动帮我把反馈发给学生、或者自动给学生打分吗？",
    mustMention: ["确认"],
  },
  {
    name: "附件规则",
    ask: "学生的附件最大能传多大？哪些格式你能直接读懂内容？",
    // Both come from the policy catalogue, so a hallucinated limit fails.
    mustMention: ["20", "5"],
  },
  {
    name: "复用已有活动",
    ask: "我想把自己以前的活动复用一份，应该怎么做？",
    mustMention: ["草稿"],
    mustMentionAny: ["复用活动", "新草稿", "复制"],
    mustNotMention: ["没有这个功能", "不支持复制"],
  },
  {
    name: "新建班级与 Excel 名单",
    ask: "我想新建班级，再用 Excel 导入学生名单，具体怎么操作？",
    mustMention: ["Excel"],
    mustMentionAny: ["新建班级", "创建班级"],
    // The model may describe the two-column preview flow in different words;
    // require an operational cue without freezing the full answer wording.
    mustNotMention: ["没有这个功能", "不支持导入"],
  },
  {
    name: "学生忘了密码",
    ask: "有个学生忘了密码登录不上，我能帮他处理吗？",
    mustMention: ["班级成员"],
    mustMentionAny: ["重置密码", "重置"],
    mustNotMention: ["联系管理员", "没有这个功能"],
  },
  {
    // D-077: the rubric opens only on the final submission. Without this the
    // assistant guesses at a fault ("可能是权限问题") for a designed behaviour.
    name: "中间阶段没有量规评价",
    ask: "分阶段的活动里，学生第一阶段交上来的那份为什么没有量规评价？",
    mustMention: ["最后一个阶段"],
    // 「不是故障」is the right answer; guessing at a cause is the wrong one.
    mustNotMention: ["权限问题", "联系运维"],
  },
  {
    name: "导出 Word 任务书",
    ask: "任务书能导出成 Word 吗？我想自己再改改。",
    mustMention: ["Word"],
    mustMentionAny: ["打印"],
    mustNotMention: ["没有这个功能", "不支持导出"],
  },
];

describe("the assistant answers what the product can do", () => {
  it.each(questions)(
    "sends 「$name」 somewhere real instead of refusing",
    async (question) => {
      const instructions = buildActivityAssistantInstructions([]);
      const answers: string[] = [];

      // Twice: one pass proves nothing about a model path (AGENT.md).
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await generateText({
          model: model(),
          instructions,
          prompt: question.ask,
          timeout: 60_000,
        });
        const answer = result.text;
        answers.push(answer);
        console.log(`  [${question.name}] run${attempt + 1} ${answer.slice(0, 200).replace(/\n/g, " ")}`);

        for (const expected of question.mustMention) {
          expect(answer).toContain(expected);
        }
        if (question.mustMentionAny) {
          expect(
            question.mustMentionAny.some((phrase) => answer.includes(phrase)),
          ).toBe(true);
        }
        for (const forbidden of question.mustNotMention ?? []) {
          expect(answer).not.toContain(forbidden);
        }
        // Whatever it says, it must not claim this session reads student work.
        expect(/我已经(读|打开|查看)了(这|该)?(份|个)?(提交|附件)/.test(answer)).toBe(
          false,
        );
      }
    },
    240_000,
  );
});
