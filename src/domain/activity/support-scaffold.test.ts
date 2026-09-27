import { describe, expect, it } from "vitest";
import { parseSupportScaffold } from "./support-scaffold";

describe("parseSupportScaffold", () => {
  it("splits the drafting convention into steps and sentence starters", () => {
    expect(
      parseSupportScaffold(
        "1. 先在记录表里写下时间和地点\n2、再描述看到的现象\n3）最后判断它算不算浪费\n可以这样写：「我在……看到……」「这说明……」",
      ),
    ).toEqual({
      steps: ["先在记录表里写下时间和地点", "再描述看到的现象", "最后判断它算不算浪费"],
      starters: ["我在……看到……", "这说明……"],
      notes: [],
    });
  });

  it("keeps free prose, decimals and bare numbers as notes", () => {
    expect(
      parseSupportScaffold("提供读数记录模板。\n3.5 米高处测一次\n3 个时间点以便比较"),
    ).toEqual({
      steps: [],
      starters: [],
      notes: ["提供读数记录模板。", "3.5 米高处测一次", "3 个时间点以便比较"],
    });
  });

  it("treats a starter line without quoted phrases as a note", () => {
    expect(parseSupportScaffold("可以这样写：先描述再判断").notes).toEqual([
      "可以这样写：先描述再判断",
    ]);
  });

  it("accepts circled numerals", () => {
    expect(parseSupportScaffold("① 分类\n② 计量").steps).toEqual(["分类", "计量"]);
  });
});
