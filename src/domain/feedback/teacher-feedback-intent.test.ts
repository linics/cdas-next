import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createTeacherFeedbackPayload,
  hashTeacherFeedbackBody,
  hashTeacherFeedbackPayload,
  normalizeTeacherFeedbackBody,
  TEACHER_FEEDBACK_BODY_MAX_LENGTH,
  teacherFeedbackPayloadSchema,
} from "./teacher-feedback-intent";

function payloadInput() {
  return {
    submissionId: randomUUID(),
    submissionRevisionId: randomUUID(),
    expectedSubmissionRevisionNumber: 2,
    expectedFeedbackVersion: 0,
    body: "证据与结论已经对应。",
    suggestionAgentRunId: null,
  };
}

describe("teacher feedback intent payload", () => {
  it("normalizes Unicode and line endings without changing visible content", () => {
    const input = payloadInput();
    const payload = createTeacherFeedbackPayload({
      ...input,
      body: "  Cafe\u0301\r\n请补充测量时间。  ",
    });

    expect(payload.body).toBe("  Café\n请补充测量时间。  ");
    expect(normalizeTeacherFeedbackBody(payload.body)).toBe(payload.body);
    expect(hashTeacherFeedbackBody(payload.body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes the complete canonical target and content deterministically", () => {
    const input = payloadInput();
    const payload = createTeacherFeedbackPayload(input);
    const reordered = {
      suggestionAgentRunId: payload.suggestionAgentRunId,
      body: payload.body,
      expectedFeedbackVersion: payload.expectedFeedbackVersion,
      expectedSubmissionRevisionNumber:
        payload.expectedSubmissionRevisionNumber,
      submissionRevisionId: payload.submissionRevisionId,
      submissionId: payload.submissionId,
      schemaVersion: payload.schemaVersion,
    };

    expect(hashTeacherFeedbackPayload(reordered)).toBe(
      hashTeacherFeedbackPayload(payload),
    );
    expect(
      hashTeacherFeedbackPayload({ ...payload, body: "反馈正文已改变" }),
    ).not.toBe(hashTeacherFeedbackPayload(payload));
    expect(
      hashTeacherFeedbackPayload({
        ...payload,
        expectedFeedbackVersion: 1,
      }),
    ).not.toBe(hashTeacherFeedbackPayload(payload));
  });

  it.each([
    "",
    " \r\n\t ",
    "\u200b",
    "\u00a0",
    "\u0085",
    "\u200d",
    "\ufe0f",
    "\u{e0100}",
  ])(
    "rejects visually empty feedback %j",
    (body) => {
      expect(() =>
        createTeacherFeedbackPayload({ ...payloadInput(), body }),
      ).toThrow();
    },
  );

  it("limits by Unicode code points and rejects noncanonical or widened payloads", () => {
    expect(() =>
      createTeacherFeedbackPayload({
        ...payloadInput(),
        body: "👍".repeat(TEACHER_FEEDBACK_BODY_MAX_LENGTH),
      }),
    ).not.toThrow();
    expect(() =>
      createTeacherFeedbackPayload({
        ...payloadInput(),
        body: "👍".repeat(TEACHER_FEEDBACK_BODY_MAX_LENGTH + 1),
      }),
    ).toThrow();

    const payload = createTeacherFeedbackPayload(payloadInput());
    expect(() =>
      teacherFeedbackPayloadSchema.parse({
        ...payload,
        body: `${payload.body}\r\n第二行`,
      }),
    ).toThrow();
    expect(() =>
      createTeacherFeedbackPayload({ ...payloadInput(), actorId: randomUUID() }),
    ).toThrow();
  });
});
