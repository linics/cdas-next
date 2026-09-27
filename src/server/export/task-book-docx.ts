import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  assignmentSubtypeLabel,
  assignmentTypeDetails,
  disciplineLabel,
  inquiryDepths,
  submissionModes,
  v3EvidenceTypeLabel,
} from "../../domain/activity/activity-content";
import {
  coreCompetencySourceLocator,
  findCoreCompetency,
} from "../../domain/curriculum/core-competencies";
import type { PrintableTaskBook } from "../queries/task-book-print";

const font = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Microsoft YaHei" };
// A4 in twentieths of a point, with the same margins as the print view.
const page = { width: 11_906, height: 16_838, marginX: 794, marginY: 907 };

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
}

function body(text: string) {
  return new Paragraph({ children: [new TextRun(text)], spacing: { after: 80 } });
}

function labelled(label: string, text: string) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}：`, bold: true }),
      // Phase support is written one step per line (D-080); Word ignores "\n".
      ...text
        .split(/\r?\n/)
        .map((line, index) => new TextRun({ text: line, break: index > 0 ? 1 : undefined })),
    ],
    spacing: { after: 60 },
  });
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "999999" };

const contentWidth = page.width - 2 * page.marginX;

function cell(text: string, width: number, header = false) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: header })] })],
  });
}

/**
 * Column widths are absolute twips with a fixed layout. Percentage widths
 * are not honoured by every renderer (macOS Quick Look collapsed them to a
 * character per line), and a 教研 document has to open correctly anywhere.
 */
function table(header: string[], weights: number[], rows: string[][]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => Math.floor((contentWidth * weight) / total));
  return new Table({
    width: { size: contentWidth, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((text, index) => cell(text, widths[index]!, true)),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            cantSplit: true,
            children: row.map((text, index) => cell(text, widths[index]!)),
          }),
      ),
    ],
  });
}

function dateLabel(iso: string): string {
  // Server-side export has no viewer time zone; state it in China time.
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * An editable Word task book for 教研 (D-074). Same content and source rules
 * as the print view (D-071): an exact draft revision or a frozen release,
 * never live form state, and no student data.
 */
export async function buildTaskBookDocx(taskBook: PrintableTaskBook): Promise<Buffer> {
  const { content } = taskBook;
  const goalName = new Map(
    content.learningGoals.map((goal, index) => [goal.id, `目标 ${index + 1}`]),
  );
  const goals = (ids: readonly string[]) => ids.map((id) => goalName.get(id) ?? id).join("、");
  const subtype = assignmentSubtypeLabel(content.assignmentType, content.assignmentSubtype);
  const depth = content.inquiryDepth
    ? inquiryDepths.find((item) => item.code === content.inquiryDepth)?.label
    : null;
  const mode = submissionModes.find((item) => item.code === content.submissionMode)?.label;

  const source =
    taskBook.kind === "DRAFT"
      ? `草稿 · 第 ${taskBook.version} 版 · 保存于 ${dateLabel(taskBook.datedAt)}`
      : `已发布 · ${taskBook.classroomName} · 发布于 ${dateLabel(taskBook.datedAt)}${
          taskBook.dueAt ? ` · 截止 ${dateLabel(taskBook.dueAt)}` : ""
        } · 来自草稿第 ${taskBook.version} 版`;

  const document = new Document({
    creator: "CDAS Next",
    title: content.title,
    styles: { default: { document: { run: { font, size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: page.width, height: page.height, orientation: PageOrientation.PORTRAIT },
            margin: { top: page.marginY, bottom: page.marginY, left: page.marginX, right: page.marginX },
          },
        },
        children: [
          new Paragraph({ children: [new TextRun({ text: source, color: "666666", size: 18 })] }),
          new Paragraph({ text: content.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.LEFT }),
          body(content.summary),

          heading("基本设置", HeadingLevel.HEADING_1),
          body(content.topic),
          body(
            [
              `${content.schoolStage === "PRIMARY" ? "小学" : "初中"} ${content.grade} 年级`,
              `主学科 ${disciplineLabel(content.mainDisciplineCode)}`,
              `融合学科 ${content.integratedDisciplineCodes.map(disciplineLabel).join("、")}`,
              [assignmentTypeDetails(content.assignmentType).label, subtype, depth]
                .filter(Boolean)
                .join(" · "),
              `${mode ?? content.submissionMode} · ${content.durationWeeks} 周`,
            ].join("；"),
          ),

          heading("背景设定", HeadingLevel.HEADING_1),
          body(content.backgroundSetting),

          heading("总体任务", HeadingLevel.HEADING_1),
          body(content.taskInstructions),

          heading("学习目标与课程依据", HeadingLevel.HEADING_1),
          ...content.learningGoals.flatMap((goal, index) => [
            labelled(`目标 ${index + 1}`, goal.description),
            body(
              `课程依据：${goal.competencyReferences
                .flatMap((reference) => {
                  const competency = findCoreCompetency(reference.disciplineCode, reference.competencyCode);
                  return competency
                    ? [`${disciplineLabel(reference.disciplineCode)}·${competency.name}（${coreCompetencySourceLocator(competency)}）`]
                    : [];
                })
                .join("；")}`,
            ),
          ]),

          heading("学科分工", HeadingLevel.HEADING_1),
          table(
            ["学科", "贡献", "不可替代性"],
            [1, 3, 3],
            content.disciplineContributions.map((item) => [
              disciplineLabel(item.disciplineCode),
              item.contribution,
              item.necessity,
            ]),
          ),

          heading("阶段任务", HeadingLevel.HEADING_1),
          ...content.phases.flatMap((phase, index) => [
            heading(`${index + 1}. ${phase.name}（建议 ${phase.suggestedLessons} 课时）`, HeadingLevel.HEADING_2),
            labelled("服务目标", goals(phase.learningGoalIds)),
            labelled("行动", phase.action),
            labelled("情境", phase.context),
            labelled("支架", phase.support),
            labelled(
              "需提交",
              phase.evidence
                .map((evidence) => `${v3EvidenceTypeLabel(evidence.type)}：${evidence.description}`)
                .join("；"),
            ),
            labelled("评价要点", phase.evaluationFocus),
          ]),

          heading("评价标准", HeadingLevel.HEADING_1),
          table(
            ["维度", "评价目标", "优秀", "良好", "达标", "需改进"],
            [2, 2, 3, 3, 3, 3],
            content.rubricDimensions.map((dimension) => [
              dimension.name,
              goals(dimension.learningGoalIds),
              dimension.excellent,
              dimension.good,
              dimension.pass,
              dimension.improve,
            ]),
          ),
        ],
      },
    ],
  });
  return Packer.toBuffer(document);
}
