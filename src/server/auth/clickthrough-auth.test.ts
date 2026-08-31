import { describe, expect, it } from "vitest";

import {
  clickthroughAudienceFromPath,
  isClickthroughAuthEnabled,
  resolveClickthroughAudience,
} from "./clickthrough-auth";

const localIds = {
  NODE_ENV: "development",
  DEV_TEST_TEACHER_CLERK_ID: "user_teacher123",
  DEV_TEST_STUDENT_CLERK_ID: "user_student123",
  DEV_TEST_ADMIN_CLERK_ID: "user_admin123",
} satisfies NodeJS.ProcessEnv;

describe("isClickthroughAuthEnabled", () => {
  it("defaults on for local next dev once demo identities exist", () => {
    expect(isClickthroughAuthEnabled(localIds)).toBe(true);
    expect(
      isClickthroughAuthEnabled({
        ...localIds,
        DEV_CLICKTHROUGH_AUTH: "1",
      }),
    ).toBe(true);
  });

  it("opts back into Clerk only when the flag is explicitly off", () => {
    expect(
      isClickthroughAuthEnabled({
        ...localIds,
        DEV_CLICKTHROUGH_AUTH: "0",
      }),
    ).toBe(false);
  });

  it("stays off in production, on Vercel, and during E2E or staging runs", () => {
    expect(
      isClickthroughAuthEnabled({
        ...localIds,
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isClickthroughAuthEnabled({
        ...localIds,
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
    expect(
      isClickthroughAuthEnabled({
        ...localIds,
        E2E_RUN_MARKER: "cdas-e2e-20260823000000-test01",
      }),
    ).toBe(false);
    expect(
      isClickthroughAuthEnabled({
        ...localIds,
        STAGING_RUN_MARKER: "cdas-staging-synthetic",
      }),
    ).toBe(false);
  });

  it("stays off unless teacher, student, and admin identities all exist", () => {
    expect(
      isClickthroughAuthEnabled({
        NODE_ENV: "development",
        DEV_TEST_TEACHER_CLERK_ID: "user_teacher123",
        DEV_TEST_STUDENT_CLERK_ID: "user_student123",
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
    expect(clickthroughAudienceFromPath("/admin")).toBe("ADMIN");
    expect(clickthroughAudienceFromPath("/admin/schools")).toBe("ADMIN");
    expect(clickthroughAudienceFromPath("/")).toBeUndefined();
  });

  it("falls back to the referring workspace for shared attachment routes", () => {
    expect(
      resolveClickthroughAudience({
        pathname: "/attachments/abc/download",
        referer: "http://localhost:3000/student/releases/r1",
      }),
    ).toBe("STUDENT");
  });
});
