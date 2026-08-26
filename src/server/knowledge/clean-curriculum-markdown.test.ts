import { describe, expect, it } from "vitest";
import {
  cleanCurriculumMarkdown,
  curriculumHeadingLevel,
  normalizeCurriculumHeading,
  stripCurriculumMarkup,
} from "./clean-curriculum-markdown";

describe("cleanCurriculumMarkdown", () => {
  it("normalizes split-bold top-level headings and does not leave 一 、 spacing", () => {
    const cleaned = cleanCurriculumMarkdown(
      ["> **前** **言**", "", "> 正文开始。", "", "> **一** **、培养目标**", "", "> 义务教育要培养学生。"].join(
        "\n",
      ),
    );

    expect(cleaned).toContain("一、培养目标");
    expect(cleaned).not.toMatch(/一\s+、/u);
    expect(normalizeCurriculumHeading("一 、培养目标")).toBe("一、培养目标");
  });

  it("drops bookmark table-of-contents lines and never treats them as headings", () => {
    const cleaned = cleanCurriculumMarkdown(
      [
        "> **目** **录**",
        "",
        "> **一** **、培养目标** [**2**](#bookmark2)",
        "",
        "> **三、课程设置** [6](#bookmark1)",
        "",
        "> [**四** **、课程内容** 16](#bookmark7)",
        "",
        "> <span id=\"bookmark2\" class=\"anchor\"></span>**一、培养目标**",
        "",
        "> 这是正文。",
      ].join("\n"),
    );

    expect(cleaned).not.toContain("bookmark");
    expect(cleaned).not.toContain("目录");
    expect(cleaned).toContain("一、培养目标");
    expect(cleaned).toContain("这是正文。");
    expect(cleaned).not.toContain("三、课程设置");
  });

  it("drops running headers with trailing roman or arabic page numbers", () => {
    const cleaned = cleanCurriculumMarkdown(
      [
        "> **一、培养目标**",
        "",
        "> 上半句",
        "",
        "**三、课程设置** II",
        "",
        "> 下半句。",
        "",
        "**四、课程内容**II",
        "",
        "> 续表。",
        "",
        "**五、学业质量**I",
        "",
        "> 质量描述。",
      ].join("\n"),
    );

    expect(cleaned).toContain("上半句");
    expect(cleaned).toContain("下半句。");
    expect(cleaned).not.toMatch(/\bII\b/u);
    expect(cleaned).not.toMatch(/课程设置\s*II/u);
    expect(normalizeCurriculumHeading("三、课程设置 II")).toBe("三、课程设置");
    expect(normalizeCurriculumHeading("四、课程内容II")).toBe("四、课程内容");
  });

  it("drops cover, publisher, English imprint, and isolated 工 glyphs", () => {
    const cleaned = cleanCurriculumMarkdown(
      [
        "> **义** **务** **教** **育**",
        "> **课程方案**",
        "> (2022年版)",
        "> 中华人民共和国教育部制定",
        '> <img src="media/image1.jpeg" />**北京师范大学出版集团**',
        "> **BEIJING NORMAL UNVERSITY PUBLISHING GROUP**",
        "> 北京师范大学出版社",
        "> **前** **言**",
        "> 习近平总书记多次强调课程教材要发挥培根铸魂作用。",
        "> 工",
        "> **一、培养目标**",
        "> 培养时代新人。",
      ].join("\n"),
    );

    expect(cleaned).toContain("一、培养目标");
    expect(cleaned).toContain("培养时代新人。");
    expect(cleaned).not.toContain("北京师范大学");
    expect(cleaned).not.toContain("出版集团");
    expect(cleaned).not.toContain("BEIJING");
    expect(cleaned).not.toContain("中华人民共和国教育部制定");
    expect(cleaned.split("\n").some((line) => line.trim() === "工")).toBe(false);
  });

  it("keeps chapter text that the manifest may later include or exclude", () => {
    const cleaned = cleanCurriculumMarkdown(
      [
        "> **四、课程标准编制与教材编写**",
        "> 原则上，各门课程用不少于10%的课时设计跨学科主题学习。",
        "> **附录1**",
        "> 优秀诗文背诵推荐篇目。",
      ].join("\n"),
    );

    expect(cleaned).toContain("四、课程标准编制与教材编写");
    expect(cleaned).toContain("10%的课时设计跨学科主题学习");
    expect(cleaned).toContain("附录1");
    expect(cleaned).toContain("优秀诗文背诵推荐篇目。");
  });

  it("strips table HTML to text and joins a heading split across Word wrapping", () => {
    expect(stripCurriculumMarkup("<p>8%～10%</p>")).toBe("8%～10%");
    const cleaned = cleanCurriculumMarkdown(
      [
        "> **四、课程内容**",
        '> <span id="bookmark13" class="anchor"></span>**初** **中** **部**',
        "> **分**… …………",
        "> （一）数与代数",
        "> 数与代数是基础。",
      ].join("\n"),
    );
    expect(cleaned).toContain("初中部分");
    expect(cleaned).toContain("（一）数与代数");
    expect(curriculumHeadingLevel("初中部分")).toBe(3);
    expect(curriculumHeadingLevel("【内容要求】")).toBe(3);
    expect(curriculumHeadingLevel("第一学段(1～2年级)")).toBe(3);
    expect(curriculumHeadingLevel("第一学段是学生进入小学学习的开始")).toBeNull();
  });

  it("rejoins a sentence split by a running chapter header", () => {
    const cleaned = cleanCurriculumMarkdown(
      [
        "> **三、课程目标**",
        "> 2. 观察大自然，热心参加校园、社区活动，积累活动体验。结",
        "",
        "**三、课程目标**",
        "",
        "> 合语文学习，用口头或图文等方式整理见闻。",
      ].join("\n"),
    );

    expect(cleaned.replaceAll("\n", "")).toContain(
      "2. 观察大自然，热心参加校园、社区活动，积累活动体验。结合语文学习",
    );
  });
});
