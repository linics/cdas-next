import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clickthroughAudienceFromPath,
  isClickthroughAuthEnabled,
  resolveClickthroughAudience,
} from "./clickthrough-auth";

const enabledEnv = {
  NODE_ENV: "development",
  DEV_CLICKTHROUGH_AUTH: "1",
  DEV_TEST_TEACHER_CLERK_ID: "user_teacher123",
  DEV_TEST_STUDENT_CLERK_ID: "user_student123",
} satisfies NodeJS.ProcessEnv;

describe("isClickthroughAuthEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on only for local next dev with explicit flag and both demo identities", () => {
    expect(isClickthroughAuthEnabled(enabledEnv)).toBe(true);
  });

  it("stays off in production even if the flag is set", () => {
    expect(
      isClickthroughAuthEnabled({
        ...enabledEnv,
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });

  it("stays off on Vercel Preview or production runtimes", () => {
    expect(
      isClickthroughAuthEnabled({
        ...enabledEnv,
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
  });

  it("stays off without the explicit flag or demo identities", () => {
    expect(
      isClickthroughAuthEnabled({
        NODE_ENV: "development",
        DEV_TEST_TEACHER_CLERK_ID: "user_teacher123",
        DEV_TEST_STUDENT_CLERK_ID: "user_student123",
      }),
    ).toBe(false);
    expect(
      isClickthroughAuthEnabled({
        NODE_ENV: "development",
        DEV_CLICKTHROUGH_AUTH: "1",
        DEV_TEST_TEACHER_CLERK_ID: "user_teacher123",
      }),
    ).toBe(false);
  });

  it("stays off during closed-loop E2E and staging runs", () => {
    expect(
      isClickthroughAuthEnabled({
        ...enabledEnv,
        E2E_RUN_MARKER: "cdas-e2e-20260823000000-test01",
      }),
    ).toBe(false);
    expect(
      isClickthroughAuthEnabled({
        ...enabledEnv,
        STAGING_RUN_MARKER: "cdas-staging-synthetic",
      }),
    ).toBe(false);
  });
});

describe("clickthrough audience mapping", () => {
  it("maps teacher and student workspaces from the request path", () => {
    expect(clickthroughAudienceFromPath("/teacher")).toBe("TEACHER");
    expect(clickthroughAudienceFromPath("/teacher/insights")).toBe("TEACHER");
    expect(clickthroughAudienceFromPath("/api/assistant/activity-draft")).toBe(
      "TEACHER",
    );
    expect(clickthroughAudienceFromPath("/student")).toBe("STUDENT");
    expect(clickthroughAudienceFromPath("/student/releases/abc")).toBe(
      "STUDENT",
    );
    expect(clickthroughAudienceFromPath("/")).toBeUndefined();
    expect(clickthroughAudienceFromPath("/attachments/abc/download")).toBeUndefined();
  });

  it("falls back to the referring workspace for shared attachment routes", () => {
    expect(
      resolveClickthroughAudience({
        pathname: "/attachments/abc/download",
        referer: "http://localhost:3000/student/releases/r1",
      }),
    ).toBe("STUDENT");
    expect(
      resolveClickthroughAudience({
        pathname: "/attachments/abc/download",
        referer: "http://localhost:3000/teacher/submissions/s1",
      }),
    ).toBe("TEACHER");
  });
});
