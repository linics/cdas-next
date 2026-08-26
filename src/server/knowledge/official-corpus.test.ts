import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getOfficialKnowledgeReference,
  listOfficialKnowledgeSources,
  readOfficialKnowledgeSection,
  searchOfficialKnowledge,
  type OfficialKnowledgeSearchInput,
} from "./official-corpus";
import corpusJson from "./generated/official-standards.json";

describe("official curriculum knowledge corpus", () => {
  it("contains only the five approved official 2022 sources", () => {
    const sources = listOfficialKnowledgeSources();

    expect(sources).toHaveLength(5);
    expect(sources.map((source) => source.id)).toEqual([
      "course-plan-2022",
      "chinese-standard-2022",
      "physics-standard-2022",
      "info-tech-standard-2022",
      "math-standard-2022",
    ]);
    expect(sources.every((source) => source.publisher === "中华人民共和国教育部")).toBe(
      true,
    );
    expect(sources.every((source) => source.version === "2022年版")).toBe(true);
    expect(sources.every((source) => /^[0-9a-f]{64}$/u.test(source.sourceHash))).toBe(
      true,
    );
    expect(
      sources.some((source) => /UbD|C-POTE|案例|团体标准/iu.test(source.title)),
    ).toBe(false);
  });

  it("returns deterministic, diversified results for simplified and traditional queries", () => {
    const input: OfficialKnowledgeSearchInput = {
      query: "初中跨学科实践 数据分析 评价",
      schoolStage: "MIDDLE",
      disciplineCodes: ["math", "infoTech"],
      limit: 8,
    };
    const simplified = searchOfficialKnowledge(input);
    const traditional = searchOfficialKnowledge({
      ...input,
      query: "初中跨學科實踐 數據分析 評價",
    });

    expect(simplified).toEqual(traditional);
    expect(simplified.status).toBe("FOUND");
    expect(new Set(simplified.results.map((result) => result.sourceId)).size).toBeGreaterThan(
      1,
    );
    expect(
      simplified.results.every((result) =>
        ["course-plan-2022", "math-standard-2022", "info-tech-standard-2022"].includes(
          result.sourceId,
        ),
      ),
    ).toBe(true);
    for (const sourceId of new Set(simplified.results.map((result) => result.sourceId))) {
      expect(
        simplified.results.filter((result) => result.sourceId === sourceId),
      ).toHaveLength(
        Math.min(
          2,
          simplified.results.filter((result) => result.sourceId === sourceId).length,
        ),
      );
    }
  });

  it("reads only canonical source-section pairs and exposes no invented page number", () => {
    const search = searchOfficialKnowledge({
      query: "第四学段 数据分析 学业质量",
      schoolStage: "MIDDLE",
      disciplineCodes: ["math"],
      limit: 4,
    });
    const hit = search.results[0];
    expect(hit).toBeDefined();
    if (!hit) return;

    const read = readOfficialKnowledgeSection({
      sourceId: hit.sourceId,
      sectionId: hit.sectionId,
    });
    expect(read.status).toBe("FOUND");
    expect(read).toMatchObject({
      sourceId: hit.sourceId,
      sectionId: hit.sectionId,
      citationLabel: hit.citationLabel,
      href: hit.href,
      publisher: "中华人民共和国教育部",
    });
    expect(hit.citationLabel).not.toMatch(/第\s*\d+\s*页/u);
    expect(getOfficialKnowledgeReference(hit.sourceId, hit.sectionId)).not.toBeNull();

    expect(
      readOfficialKnowledgeSection({
        sourceId: "course-plan-2022",
        sectionId: hit.sectionId,
      }).status,
    ).toBe(hit.sourceId === "course-plan-2022" ? "FOUND" : "NOT_FOUND");
  });

  it("returns an explicit no-match result instead of fabricating a source", () => {
    expect(
      searchOfficialKnowledge({ query: "zzzxxyyqq", limit: 6 }),
    ).toEqual({ status: "NO_MATCH", results: [] });
  });

  it("keeps numbered requirements and clauses split by Word page headers intact", () => {
    const sections = corpusJson.sources.flatMap((source) => source.sections);
    const chineseSections = corpusJson.sources.find(
      (source) => source.id === "chinese-standard-2022",
    )?.sections;

    expect(chineseSections).toBeDefined();
    expect(
      chineseSections?.some((section) =>
        section.content.includes(
          "2. 观察大自然，热心参加校园、社区活动，积累活动体验。结合语文学习",
        ),
      ),
    ).toBe(true);
    expect(
      sections.some((section) => / > \d{1,2}\s*[.、．]/u.test(section.locator)),
    ).toBe(false);
    expect(
      sections.some((section) =>
        /(?:^|\n\n)(?:合语文学习|影视作品|的事物)/u.test(section.content),
      ),
    ).toBe(false);
    expect(
      chineseSections?.some((section) =>
        section.content.includes("\n\n三、课程目标\n\n"),
      ),
    ).toBe(false);
  });

  it("indexes every manifest top-level chapter and keeps the 10% interdisciplinary clause searchable", () => {
    for (const source of corpusJson.sources) {
      const tops = new Set(source.sections.map((section) => section.headingPath[0]));
      for (const heading of source.includedTopLevelHeadings) {
        expect(tops.has(heading), `${source.id} missing ${heading}`).toBe(true);
      }
    }

    const search = searchOfficialKnowledge({
      query: "跨学科主题学习 课时",
    });
    expect(search.status).toBe("FOUND");
    const hit = search.results.find(
      (result) =>
        result.sourceId === "course-plan-2022" &&
        result.locator.includes("四、课程标准编制与教材编写"),
    );
    expect(
      hit,
      search.results.map((result) => `${result.sourceId} | ${result.locator}`).join(" ; "),
    ).toBeDefined();
    if (!hit) return;
    const read = readOfficialKnowledgeSection({
      sourceId: hit.sourceId,
      sectionId: hit.sectionId,
    });
    expect(read.status).toBe("FOUND");
    if (read.status !== "FOUND") return;
    expect(read.content).toContain("10%的课时设计跨学科主题学习");
  });

  it("does not retain Word furniture in locators or section bodies", () => {
    const sections = corpusJson.sources.flatMap((source) => source.sections);
    for (const section of sections) {
      expect(section.locator).not.toMatch(/目录|前言|北京师范大学|出版集团/u);
      expect(section.locator).not.toMatch(/一\s+、/u);
      expect(section.locator).not.toMatch(
        /(?:^| > )[IVXLCDMⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+(?:$| > )/u,
      );
      expect(section.content).not.toMatch(/北京师范大学|出版集团/u);
      expect(section.content).not.toMatch(
        /(?:^|\n)(?:目录|前言|义务教育(?:课程方案|(?:语文|数学|物理|信息科技)课程标准)\(?2022年版\)?)(?:\n|$)/u,
      );
    }
  });

  it("keeps the five course-plan chapters required by the corrected manifest", () => {
    const coursePlan = corpusJson.sources.find((source) => source.id === "course-plan-2022");
    expect(coursePlan?.includedTopLevelHeadings).toEqual([
      "一、培养目标",
      "二、基本原则",
      "三、课程设置",
      "四、课程标准编制与教材编写",
      "五、课程实施",
    ]);
    expect(new Set(coursePlan?.sections.map((section) => section.headingPath[0]))).toEqual(
      new Set(coursePlan?.includedTopLevelHeadings),
    );
  });

  it("keeps 学段 in locators so identical 【…】 blocks stay distinguishable", () => {
    const chineseSections = corpusJson.sources.find(
      (source) => source.id === "chinese-standard-2022",
    )?.sections;
    expect(chineseSections).toBeDefined();
    expect(
      chineseSections?.some((section) =>
        /第一学段[^>]* > 【识字与写字】/u.test(section.locator),
      ),
    ).toBe(true);

    const readingByStage = (chineseSections ?? [])
      .map((section) => section.locator)
      .filter((locator) => locator.includes("【阅读与鉴赏】"));
    const stages = new Set(
      readingByStage.map((locator) => {
        const match = locator.match(/第[一二三四五六七八九十]+学段/u);
        return match?.[0];
      }),
    );
    expect(stages.has("第一学段")).toBe(true);
    expect(stages.has("第二学段")).toBe(true);
    expect(new Set(readingByStage).size).toBeGreaterThan(1);
  });
});
