import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";

vi.mock("server-only", () => ({}));

import { TeacherActivityQueryError } from "./teacher-activity-workspace";

import {
  getTeacherInsights,
  teacherInsightsDashboardSchema,
} from "./teacher-insights";

function context(
  source: CommandContext["source"] = "UI",
): CommandContext {
  return {
    actorId: "50000000-0000-4000-8000-000000000005",
    source,
    traceId: "teacher-insights-trace",
    clock: () => new Date("2026-08-27T04:00:00.000Z"),
  };
}

describe("teacher insights query boundary", () => {
  it("reports a student role mismatch before scanning releases", async () => {
    const activityReleaseFindMany = vi.fn();
    const database = {
      appUser: {
        findUnique: vi.fn().mockResolvedValue({
          role: "STUDENT",
          displayName: "陈同学",
        }),
      },
      activityRelease: { findMany: activityReleaseFindMany },
    } as unknown as PrismaClient;

    await expect(getTeacherInsights(database, context(), {})).rejects.toEqual(
      new TeacherActivityQueryError("WRONG_ROLE", "陈同学"),
    );
    expect(activityReleaseFindMany).not.toHaveBeenCalled();
  });

  it("rejects extra fields on the insights dashboard contract", () => {
    const dashboard = {
      actor: { displayName: "林老师" },
      selectedReleaseId: null,
      releaseOptions: [],
      rubric: [],
      stages: [],
      improvement: {
        reviseCount: 0,
        resubmittedCount: 0,
        evaluationPairs: 0,
        rose: 0,
        unchanged: 0,
        fell: 0,
      },
    };
    expect(teacherInsightsDashboardSchema.safeParse(dashboard).success).toBe(true);
    expect(
      teacherInsightsDashboardSchema.safeParse({
        ...dashboard,
        improvement: {
          ...dashboard.improvement,
          summary: "must-not-strip",
        },
      }).success,
    ).toBe(false);
  });
});

describe("teacher insights source boundary", () => {
  it("keeps the same role boundary for Agent reads and refuses other sources", async () => {
    const database = {
      appUser: {
        findUnique: vi.fn().mockResolvedValue({
          role: "STUDENT",
          displayName: "陈同学",
        }),
      },
      activityRelease: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    await expect(
      getTeacherInsights(database, context("AGENT"), {}),
    ).rejects.toEqual(
      new TeacherActivityQueryError("WRONG_ROLE", "陈同学"),
    );
    await expect(
      getTeacherInsights(database, context("SYSTEM"), {}),
    ).rejects.toThrow(TypeError);
  });
});
