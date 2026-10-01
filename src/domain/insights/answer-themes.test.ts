import { describe, expect, it } from "vitest";
import {
  ANSWER_THEMES_MAX_ANSWER_CHARS,
  AnswerThemesOutputError,
  answerTextForModel,
  resolveAnswerThemes,
  type AnswerForThemes,
} from "./answer-themes";

const answers: AnswerForThemes[] = [
  { submissionId: "s1", revisionId: "r1", text: "二楼饮水机旁边在漏水，\n一分钟大约滴 40 滴。" },
  { submissionId: "s2", revisionId: "r2", text: "操场水龙头一直滴水，没有人管。" },
  { submissionId: "s3", revisionId: "r3", text: "厕所的水箱关不紧，一直在流。" },
];

function theme(evidence: { answer: number; quote: string }[]) {
  return {
    summary: "多数作答写了漏水的位置。",
    themes: [{ kind: "STRENGTH" as const, statement: "都写了漏水位置", evidence }],
  };
}

describe("answer themes", () => {
  it("keeps a theme whose quotes are literally in two different answers", () => {
    expect(
      resolveAnswerThemes(
        answers,
        theme([
          // Line breaks and spaces in the original are not a misquote.
          { answer: 1, quote: "旁边在漏水，一分钟大约滴40滴" },
          { answer: 2, quote: "操场水龙头一直滴水" },
        ]),
      ),
    ).toEqual([
      {
        kind: "STRENGTH",
        statement: "都写了漏水位置",
        sources: [
          { submissionId: "s1", revisionId: "r1", quote: "旁边在漏水，一分钟大约滴40滴" },
          { submissionId: "s2", revisionId: "r2", quote: "操场水龙头一直滴水" },
        ],
      },
    ]);
  });

  it("drops paraphrases, wrong attributions, out-of-range answers and repeats", () => {
    const resolved = resolveAnswerThemes(answers, {
      summary: "多数作答写了漏水的位置。",
      themes: [
        {
          kind: "GAP",
          statement: "没有写判断依据",
          evidence: [
            { answer: 1, quote: "饮水机附近有漏水现象" }, // paraphrase
            { answer: 2, quote: "厕所的水箱关不紧" }, // real text, wrong answer
            { answer: 9, quote: "操场水龙头一直滴水" }, // no such answer
            { answer: 3, quote: "厕所的水箱关不紧" },
            { answer: 3, quote: "一直在流" }, // same answer twice counts once
            { answer: 2, quote: "滴水" }, // too short to mean anything
          ],
        },
        {
          kind: "STRENGTH",
          statement: "都写了漏水位置",
          evidence: [
            { answer: 2, quote: "操场水龙头一直滴水" },
            { answer: 3, quote: "厕所的水箱关不紧" },
          ],
        },
      ],
    });
    // The first theme is left with one real source: not common, so it goes.
    expect(resolved.map((item) => item.statement)).toEqual(["都写了漏水位置"]);
  });

  it("rejects the whole summary when no offered theme is grounded", () => {
    expect(() =>
      resolveAnswerThemes(
        answers,
        theme([
          { answer: 1, quote: "学生普遍缺乏数据意识" },
          { answer: 2, quote: "观察不够细致" },
        ]),
      ),
    ).toThrow(new AnswerThemesOutputError("UNGROUNDED"));
  });

  it("accepts a summary that honestly found nothing in common", () => {
    expect(
      resolveAnswerThemes(answers, { summary: "三份作答写的地点各不相同。", themes: [] }),
    ).toEqual([]);
  });

  it("checks quotes against the same cut the model was given", () => {
    const long = "水".repeat(ANSWER_THEMES_MAX_ANSWER_CHARS) + "结尾才出现的一句话";
    expect(Array.from(answerTextForModel(long))).toHaveLength(
      ANSWER_THEMES_MAX_ANSWER_CHARS,
    );
    expect(() =>
      resolveAnswerThemes(
        [{ submissionId: "s1", revisionId: "r1", text: long }, answers[1]!, answers[2]!],
        theme([
          { answer: 1, quote: "结尾才出现的一句话" },
          { answer: 2, quote: "操场水龙头一直滴水" },
        ]),
      ),
    ).toThrow(AnswerThemesOutputError);
  });
});
