# 官方课程标准语料（2022 年版）

这不是通用知识库。它只为“生成跨学科任务书时能核对官方课程依据”服务，来源固定为教育部 2022 年义务教育课程方案，以及道德与法治、语文、数学、英语、科学、历史、地理、物理、化学、生物学、信息科技、劳动、艺术、体育与健康等 14 门课程标准。综合实践活动暂不提供独立课标语料。

## 来源与转换

- Word 原件来自并列旧项目的 `cdas/storage/raw/curriculum_standards/`。
- 发布机构、版本与文件清单以教育部发布页为准：<https://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html>。
- 当前 Markdown 使用 Pandoc 3.9.0.2 和 `--track-changes=all -t gfm` 从 Word 机械转换，未把 AI 改写文本混入原文。原始导出放在 `raw/`，构建时只读、永不改写。
- 用 `pnpm knowledge:extract` 重抽；`--only-new` 只写入主线尚未收录的学科，避免改写已稳定的章节 ID。
- 清洗器只去掉封面、目录页、页眉页脚、出版社信息行和书签锚点，不做章节取舍。
- `manifest.json` 的 `includedTopLevelHeadings` 才是生产检索白名单。构建脚本只索引已圈定章节；前言、目录、附录及未列章节不会进入生成索引。
- Word OOXML 不能稳定恢复物理页码，因此引用只使用来源标题、章节层级与稳定 section ID，不显示伪造页码。

## 明确排除

UbD、C-POTE、T/CAET、跨学科设计流程、教材、教师样例和 AI 历史产物不进入证据语料。程序性设计方法由助手指令与 schema 约束承担。

## 可复现构建

```bash
pnpm knowledge:extract -- --only-new
pnpm knowledge:build
pnpm knowledge:check
```

构建结果位于 `src/server/knowledge/generated/official-standards.json`。来源 Markdown、章节正文与生成结果均带 SHA-256；相同输入必须生成相同 section ID、排序和内容。
