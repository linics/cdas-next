import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getOfficialKnowledgeReference,
  listOfficialKnowledgeSources,
  officialKnowledgeCoversDiscipline,
  readOfficialKnowledgeSection,
  searchOfficialKnowledge,
  type OfficialKnowledgeSearchInput,
} from "./official-corpus";
import corpusJson from "./generated/official-standards.json";

describe("official curriculum knowledge corpus", () => {
  it("contains the course plan and all fourteen approved official 2022 subject standards", () => {
    const sources = listOfficialKnowledgeSources();

    expect(sources).toHaveLength(15);
    expect(sources.map((source) => source.id)).toEqual([
      "course-plan-2022",
      "politics-standard-2022",
      "chinese-standard-2022",
      "history-standard-2022",
      "english-standard-2022",
      "geography-standard-2022",
      "science-standard-2022",
      "physics-standard-2022",
      "biology-standard-2022",
      "info-tech-standard-2022",
      "sports-standard-2022",
      "arts-standard-2022",
      "labor-standard-2022",
      "math-standard-2022",
      "chemistry-standard-2022",
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
        /(?:^|\n)(?:目录|前言|义务教育(?:课程方案|(?:道德与法治|语文|数学|英语|科学|历史|地理|物理|化学|生物学|信息科技|劳动|艺术|体育与健康)课程标准)\(?2022年版\)?)(?:\n|$)/u,
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

    const readingByStage = [
      ...new Set(
        (chineseSections ?? [])
          .map((section) => section.locator)
          .filter((locator) => locator.includes("【阅读与鉴赏】")),
      ),
    ];
    expect(readingByStage).toHaveLength(4);
    expect(readingByStage).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/第一学段[^>]* > 【阅读与鉴赏】/u),
        expect.stringMatching(/第二学段[^>]* > 【阅读与鉴赏】/u),
        expect.stringMatching(/第三学段[^>]* > 【阅读与鉴赏】/u),
        expect.stringMatching(/第四学段[^>]* > 【阅读与鉴赏】/u),
      ]),
    );
  });

  it("does not leave empty heading-path slots when 【…】 is not under a 学段", () => {
    const locators = corpusJson.sources.flatMap((source) =>
      source.sections.map((section) => section.locator),
    );
    expect(locators.length).toBeGreaterThan(0);
    for (const locator of locators) {
      expect(locator.split(" > ").every((part) => part.trim().length > 0)).toBe(
        true,
      );
      expect(locator).not.toMatch(/ >  > /u);
    }

    const physicsLocators = corpusJson.sources
      .find((source) => source.id === "physics-standard-2022")
      ?.sections.map((section) => section.locator);
    expect(physicsLocators?.some((locator) => locator === "四、课程内容 > （一）物质 > 【内容要求】")).toBe(
      true,
    );

    const infoTechLocators = corpusJson.sources
      .find((source) => source.id === "info-tech-standard-2022")
      ?.sections.map((section) => section.locator);
    expect(infoTechLocators?.some((locator) => locator === "四、课程内容 > （三）跨学科主题")).toBe(
      true,
    );
  });

  it("keeps distinctive course-plan clauses findable after the 14-subject expansion", () => {
    const search = searchOfficialKnowledge({
      query: "跨学科主题学习 课时",
      limit: 8,
    });
    expect(search.status).toBe("FOUND");
    expect(
      search.results.some((result) => result.sourceId === "course-plan-2022"),
    ).toBe(true);
  });

  it("indexes expanded subjects and does not treat 综合实践活动 as covered", () => {
    const chemistry = searchOfficialKnowledge({
      query: "化学 跨学科实践",
      schoolStage: "MIDDLE",
      disciplineCodes: ["chemistry"],
      limit: 4,
    });
    expect(chemistry.status).toBe("FOUND");
    expect(chemistry.results.every((result) =>
      ["course-plan-2022", "chemistry-standard-2022"].includes(result.sourceId),
    )).toBe(true);

    expect(officialKnowledgeCoversDiscipline("chemistry")).toBe(true);
    expect(officialKnowledgeCoversDiscipline("integrated")).toBe(false);
  });
});
