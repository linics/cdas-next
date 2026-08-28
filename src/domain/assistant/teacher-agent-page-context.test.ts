import { describe, expect, it } from "vitest";
import {
  getTeacherAgentPageContext,
  teacherAgentPageContextSchema,
} from "./teacher-agent-page-context";

const resourceId = "10000000-0000-4000-8000-000000000001";

describe("teacher Agent page context", () => {
  it.each([
    ["/teacher", { kind: "TEACHER_DASHBOARD" }],
    ["/teacher/activities/new", { kind: "ACTIVITY_NEW" }],
    ["/teacher/insights", { kind: "TEACHER_INSIGHTS" }],
    ["/teacher/knowledge", { kind: "TEACHER_KNOWLEDGE" }],
    [
      `/teacher/activities/${resourceId}`,
      { kind: "ACTIVITY_DRAFT", resourceId },
    ],
    [
      `/teacher/activities/${resourceId}/preview`,
      { kind: "ACTIVITY_PREVIEW", resourceId },
    ],
    [
      `/teacher/releases/${resourceId}/submissions`,
      { kind: "RELEASE_SUBMISSIONS", resourceId },
    ],
    [
      `/teacher/classrooms/${resourceId}/members`,
      { kind: "CLASSROOM_MEMBERS", resourceId },
    ],
    [
      `/teacher/submissions/${resourceId}`,
      { kind: "SUBMISSION_REVIEW" },
    ],
  ])("maps %s to an allowlisted context", (pathname, expected) => {
    expect(getTeacherAgentPageContext(pathname)).toEqual(expected);
  });

  it("does not carry query strings, arbitrary paths, or submission ids", () => {
    expect(getTeacherAgentPageContext("/teacher/knowledge?source=forged")).toEqual({
      kind: "UNKNOWN_TEACHER_PAGE",
    });
    expect(getTeacherAgentPageContext("/teacher/arbitrary/private")).toEqual({
      kind: "UNKNOWN_TEACHER_PAGE",
    });
    expect(
      getTeacherAgentPageContext(`/teacher/submissions/${resourceId}`),
    ).not.toHaveProperty("resourceId");
  });

  it("rejects extra client-controlled fields", () => {
    expect(
      teacherAgentPageContextSchema.safeParse({
        kind: "TEACHER_DASHBOARD",
        href: "https://example.test/forged",
      }).success,
    ).toBe(false);
  });
});
