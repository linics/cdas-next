import { z } from "zod";
import type { ActivityContentV3 } from "./activity-content";

/**
 * What a version diagnosis may comment on (D-068). Structural coverage —
 * every goal carried by a phase and judged by a rubric dimension, every
 * discipline with a contribution — is already enforced by the v3 schema, so a
 * saved task book always satisfies it. The diagnosis is about quality the
 * schema cannot see.
 */
export const diagnosisCategories = [
  { code: "ALIGNMENT", label: "目标与任务对齐" },
  { code: "DISCIPLINE", label: "学科贡献" },
  { code: "EVIDENCE", label: "证据可观察性" },
  { code: "RUBRIC", label: "评价区分度" },
  { code: "CONTEXT", label: "情境真实性" },
  { code: "FEASIBILITY", label: "年级与课时可行性" },
] as const;

export type DiagnosisCategory = (typeof diagnosisCategories)[number]["code"];

export const diagnosisCategoryLabels = Object.fromEntries(
  diagnosisCategories.map((item) => [item.code, item.label]),
) as Record<DiagnosisCategory, string>;

export type DiagnosisTarget = Readonly<{ target: string; label: string }>;

/**
 * Every field a finding may point at, named the way the draft form names it.
 * A finding whose target is not in this list is rejected: a suggestion the
 * teacher cannot locate is not a suggestion they can act on.
 */
export function diagnosisTargets(content: ActivityContentV3): DiagnosisTarget[] {
  const targets: DiagnosisTarget[] = [
    { target: "summary", label: "任务描述" },
    { target: "backgroundSetting", label: "背景设定" },
    { target: "taskInstructions", label: "总体任务说明" },
  ];
  content.learningGoals.forEach((_, index) =>
    targets.push({ target: `learningGoals.${index + 1}`, label: `学习目标 ${index + 1}` }),
  );
  content.disciplineContributions.forEach((_, index) =>
    targets.push({
      target: `disciplineContributions.${index + 1}`,
      label: `学科贡献 ${index + 1}`,
    }),
  );
  content.phases.forEach((phase, index) => {
    targets.push({ target: `phases.${index + 1}`, label: `阶段 ${index + 1}「${phase.name}」` });
    phase.evidence.forEach((_, evidenceIndex) =>
      targets.push({
        target: `phases.${index + 1}.evidence.${evidenceIndex + 1}`,
        label: `阶段 ${index + 1} · 证据 ${evidenceIndex + 1}`,
      }),
    );
  });
  content.rubricDimensions.forEach((dimension, index) =>
    targets.push({
      target: `rubricDimensions.${index + 1}`,
      label: `评价维度 ${index + 1}「${dimension.name}」`,
    }),
  );
  return targets;
}

export const diagnosisModelOutputSchema = z
  .object({
    summary: z.string().trim().min(10).max(400),
    findings: z
      .array(
        z
          .object({
            target: z.string().trim().min(1).max(80),
            category: z.enum(
              diagnosisCategories.map((item) => item.code) as [
                DiagnosisCategory,
                ...DiagnosisCategory[],
              ],
            ),
            problem: z.string().trim().min(4).max(300),
            suggestion: z.string().trim().min(4).max(600),
          }),
        // Not strict: json_object mode sometimes echoes the target's label as
        // an extra key. Unknown keys are dropped, never stored or shown.
      )
      .max(8),
  })
  .strict();

export type DiagnosisModelOutput = z.infer<typeof diagnosisModelOutputSchema>;

/** The stored shape: each finding carries the label it had in that version. */
export const storedDiagnosisFindingsSchema = z
  .array(
    z
      .object({
        target: z.string(),
        label: z.string(),
        category: diagnosisModelOutputSchema.shape.findings.element.shape.category,
        problem: z.string(),
        suggestion: z.string(),
      })
      .strict(),
  )
  .max(8);

export type StoredDiagnosisFinding = z.infer<
  typeof storedDiagnosisFindingsSchema
>[number];

export class DiagnosisOutputError extends Error {
  constructor(public readonly code: "UNKNOWN_TARGET" | "REPEATED_FINDING") {
    super(code);
    this.name = "DiagnosisOutputError";
  }
}

/**
 * Pin every finding to a real field of this version and label it. Unknown
 * targets and the same point made twice fail the whole diagnosis closed.
 */
export function resolveDiagnosisFindings(
  content: ActivityContentV3,
  output: DiagnosisModelOutput,
): StoredDiagnosisFinding[] {
  const labels = new Map(
    diagnosisTargets(content).map((item) => [item.target, item.label]),
  );
  const seen = new Set<string>();
  return output.findings.map((finding) => {
    const label = labels.get(finding.target);
    if (!label) throw new DiagnosisOutputError("UNKNOWN_TARGET");
    const key = `${finding.target}:${finding.category}`;
    if (seen.has(key)) throw new DiagnosisOutputError("REPEATED_FINDING");
    seen.add(key);
    return { ...finding, label };
  });
}
