import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  hasMeaningfulTextEvidence,
  normalizeTextEvidence,
} from "../submission/text-evidence";
import { TEACHER_FEEDBACK_BODY_MAX_LENGTH } from "./teacher-feedback-policy";

export { TEACHER_FEEDBACK_BODY_MAX_LENGTH } from "./teacher-feedback-policy";
export const TEACHER_FEEDBACK_INTENT_TTL_MS = 10 * 60 * 1_000;

export function normalizeTeacherFeedbackBody(value: string): string {
  return normalizeTextEvidence(value);
}

const canonicalFeedbackBodySchema = z
  .string()
  .superRefine((value, context) => {
    if (value !== normalizeTeacherFeedbackBody(value)) {
      context.addIssue({
        code: "custom",
        message: "Feedback body must already be normalized",
      });
    }
    if (!hasMeaningfulTextEvidence(value)) {
      context.addIssue({
        code: "custom",
        message: "Feedback body must contain visible content",
      });
    }
    if ([...value].length > TEACHER_FEEDBACK_BODY_MAX_LENGTH) {
      context.addIssue({
        code: "too_big",
        maximum: TEACHER_FEEDBACK_BODY_MAX_LENGTH,
        origin: "string",
        inclusive: true,
        message: `Feedback body cannot exceed ${TEACHER_FEEDBACK_BODY_MAX_LENGTH} Unicode characters`,
      });
    }
  });

const teacherFeedbackPayloadInputSchema = z
  .object({
    submissionId: z.uuid(),
    submissionRevisionId: z.uuid(),
    expectedSubmissionRevisionNumber: z.int().positive(),
    expectedFeedbackVersion: z.int().nonnegative(),
    body: z.string(),
    suggestionAgentRunId: z.uuid().nullable().default(null),
  })
  .strict();

export const teacherFeedbackPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    submissionId: z.uuid(),
    submissionRevisionId: z.uuid(),
    expectedSubmissionRevisionNumber: z.int().positive(),
    expectedFeedbackVersion: z.int().nonnegative(),
    body: canonicalFeedbackBodySchema,
    suggestionAgentRunId: z.uuid().nullable(),
  })
  .strict();

export type TeacherFeedbackPayload = z.infer<
  typeof teacherFeedbackPayloadSchema
>;

export function createTeacherFeedbackPayload(
  rawInput: unknown,
): TeacherFeedbackPayload {
  const input = teacherFeedbackPayloadInputSchema.parse(rawInput);
  return teacherFeedbackPayloadSchema.parse({
    schemaVersion: 1,
    submissionId: input.submissionId,
    submissionRevisionId: input.submissionRevisionId,
    expectedSubmissionRevisionNumber:
      input.expectedSubmissionRevisionNumber,
    expectedFeedbackVersion: input.expectedFeedbackVersion,
    body: normalizeTeacherFeedbackBody(input.body),
    suggestionAgentRunId: input.suggestionAgentRunId,
  });
}

function hashCanonicalValue(value: unknown, message: string): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError(message);
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

export function hashTeacherFeedbackPayload(rawPayload: unknown): string {
  const payload = teacherFeedbackPayloadSchema.parse(rawPayload);
  return hashCanonicalValue(
    payload,
    "Teacher feedback payload cannot be canonicalized",
  );
}

export function hashTeacherFeedbackBody(rawBody: unknown): string {
  const body = canonicalFeedbackBodySchema.parse(rawBody);
  return createHash("sha256").update(body).digest("hex");
}
