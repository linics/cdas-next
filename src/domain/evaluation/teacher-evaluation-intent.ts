import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import type { ActivityContent } from "../activity/activity-content";
import {
  hasMeaningfulTextEvidence,
  normalizeTextEvidence,
} from "../submission/text-evidence";
import {
  TEACHER_EVALUATION_MAX_CITATIONS,
  TEACHER_EVALUATION_SUMMARY_MAX_LENGTH,
  teacherEvaluationLevels,
} from "./teacher-evaluation-policy";

export {
  TEACHER_EVALUATION_INTENT_TTL_MS,
  TEACHER_EVALUATION_SUMMARY_MAX_LENGTH,
} from "./teacher-evaluation-policy";

export function normalizeTeacherEvaluationSummary(value: string): string {
  return normalizeTextEvidence(value);
}

const canonicalSummarySchema = z.string().superRefine((value, context) => {
  if (value !== normalizeTeacherEvaluationSummary(value)) {
    context.addIssue({
      code: "custom",
      message: "Evaluation summary must already be normalized",
    });
  }
  if (!hasMeaningfulTextEvidence(value)) {
    context.addIssue({
      code: "custom",
      message: "Evaluation summary must contain visible content",
    });
  }
  if ([...value].length > TEACHER_EVALUATION_SUMMARY_MAX_LENGTH) {
    context.addIssue({
      code: "too_big",
      maximum: TEACHER_EVALUATION_SUMMARY_MAX_LENGTH,
      origin: "string",
      inclusive: true,
      message: `Evaluation summary cannot exceed ${TEACHER_EVALUATION_SUMMARY_MAX_LENGTH} Unicode characters`,
    });
  }
});

const textCitationSchema = z.object({ kind: z.literal("text") }).strict();
const attachmentCitationSchema = z
  .object({
    kind: z.literal("attachment"),
    attachmentId: z.uuid(),
  })
  .strict();
const checkpointCitationSchema = z
  .object({
    kind: z.literal("checkpoint"),
    evidenceIndex: z.int().positive(),
  })
  .strict();

export const teacherEvaluationCitationSchema = z.discriminatedUnion("kind", [
  textCitationSchema,
  attachmentCitationSchema,
  checkpointCitationSchema,
]);

const levelOutcomeSchema = z
  .object({
    dimensionIndex: z.int().min(1).max(8),
    dimensionName: z.string().trim().min(1).max(100),
    status: z.literal("LEVEL"),
    level: z.enum(teacherEvaluationLevels),
    citations: z
      .array(teacherEvaluationCitationSchema)
      .min(1)
      .max(TEACHER_EVALUATION_MAX_CITATIONS),
  })
  .strict();

const insufficientOutcomeSchema = z
  .object({
    dimensionIndex: z.int().min(1).max(8),
    dimensionName: z.string().trim().min(1).max(100),
    status: z.literal("INSUFFICIENT_EVIDENCE"),
    citations: z.array(teacherEvaluationCitationSchema).max(0),
  })
  .strict();

export const teacherEvaluationOutcomeSchema = z.discriminatedUnion("status", [
  levelOutcomeSchema,
  insufficientOutcomeSchema,
]);

export const teacherEvaluationPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    submissionId: z.uuid(),
    submissionRevisionId: z.uuid(),
    expectedSubmissionRevisionNumber: z.int().positive(),
    expectedEvaluationVersion: z.int().nonnegative(),
    summary: canonicalSummarySchema,
    outcomes: z.array(teacherEvaluationOutcomeSchema).min(4).max(8),
    suggestionAgentRunId: z.uuid().nullable(),
  })
  .strict();

export type TeacherEvaluationCitation = z.infer<
  typeof teacherEvaluationCitationSchema
>;
export type TeacherEvaluationOutcome = z.infer<
  typeof teacherEvaluationOutcomeSchema
>;
export type TeacherEvaluationPayload = z.infer<
  typeof teacherEvaluationPayloadSchema
>;

export type TeacherEvaluationEvidence = Readonly<{
  content: ActivityContent;
  textEvidence: string;
  attachmentIds: readonly string[];
  completedEvidenceIndexes: readonly number[];
}>;

const payloadInputSchema = z
  .object({
    submissionId: z.uuid(),
    submissionRevisionId: z.uuid(),
    expectedSubmissionRevisionNumber: z.int().positive(),
    expectedEvaluationVersion: z.int().nonnegative(),
    summary: z.string(),
    outcomes: z.array(z.unknown()).min(1).max(8),
    suggestionAgentRunId: z.uuid().nullable().default(null),
  })
  .strict();

function citationKey(citation: TeacherEvaluationCitation): string {
  if (citation.kind === "text") return "text";
  if (citation.kind === "attachment") {
    return `attachment:${citation.attachmentId}`;
  }
  return `checkpoint:${citation.evidenceIndex}`;
}

function citationIsAuthorized(
  citation: TeacherEvaluationCitation,
  evidence: TeacherEvaluationEvidence,
): boolean {
  if (citation.kind === "text") {
    return hasMeaningfulTextEvidence(evidence.textEvidence);
  }
  if (citation.kind === "attachment") {
    return evidence.attachmentIds.includes(citation.attachmentId);
  }
  return evidence.completedEvidenceIndexes.includes(citation.evidenceIndex);
}

export function createTeacherEvaluationPayload(
  rawInput: unknown,
  evidence: TeacherEvaluationEvidence,
): TeacherEvaluationPayload {
  const input = payloadInputSchema.parse(rawInput);
  if (evidence.content.schemaVersion !== 2 && evidence.content.schemaVersion !== 3) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["outcomes"],
        message: "Evidence-bound evaluation requires a structured task-book rubric",
      },
    ]);
  }

  const dimensions = evidence.content.rubricDimensions;
  const payload = teacherEvaluationPayloadSchema.parse({
    schemaVersion: 1,
    submissionId: input.submissionId,
    submissionRevisionId: input.submissionRevisionId,
    expectedSubmissionRevisionNumber: input.expectedSubmissionRevisionNumber,
    expectedEvaluationVersion: input.expectedEvaluationVersion,
    summary: normalizeTeacherEvaluationSummary(input.summary),
    outcomes: input.outcomes,
    suggestionAgentRunId: input.suggestionAgentRunId,
  });

  if (payload.outcomes.length !== dimensions.length) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["outcomes"],
        message: "Evaluation must cover every frozen rubric dimension",
      },
    ]);
  }

  payload.outcomes.forEach((outcome, index) => {
    const dimension = dimensions[index];
    if (
      !dimension ||
      outcome.dimensionIndex !== index + 1 ||
      outcome.dimensionName !== dimension.name
    ) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["outcomes", index],
          message: "Outcome must match the frozen snapshot rubric in order",
        },
      ]);
    }

    const keys = outcome.citations.map(citationKey);
    if (new Set(keys).size !== keys.length) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["outcomes", index, "citations"],
          message: "Citations in a dimension must be unique",
        },
      ]);
    }

    if (
      outcome.status === "LEVEL" &&
      outcome.citations.some(
        (citation) => !citationIsAuthorized(citation, evidence),
      )
    ) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["outcomes", index, "citations"],
          message: "Citations must name evidence on the current revision",
        },
      ]);
    }
  });

  return payload;
}

function hashCanonicalValue(value: unknown, message: string): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError(message);
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

export function hashTeacherEvaluationPayload(rawPayload: unknown): string {
  const payload = teacherEvaluationPayloadSchema.parse(rawPayload);
  return hashCanonicalValue(
    payload,
    "Teacher evaluation payload cannot be canonicalized",
  );
}

export function hashTeacherEvaluationSummary(rawSummary: unknown): string {
  const summary = canonicalSummarySchema.parse(rawSummary);
  return createHash("sha256").update(summary).digest("hex");
}
