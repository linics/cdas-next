import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import {
  TeacherActivityQueryError,
  type TeacherActivityDashboard,
} from "../queries/teacher-activity-workspace";
import { createTeacherReleaseInsightsReader } from "./teacher-release-insights";

vi.mock("server-only", () => ({}));

const actorId = "10000000-0000-4000-8000-000000000001";
const releaseId = "60000000-0000-4000-8000-000000000006";
const foreignReleaseId = "90000000-0000-4000-8000-000000000009";
const now = new Date("2026-08-29T04:00:00.000Z");

const workspace: TeacherActivityDashboard = {
  actor: { displayName: "林老师" },
  classrooms: [],
  drafts: [],
  releases: [
    {
      id: releaseId,
      title: "校园节水行动",
      classroomName: "七年一班",
      status: "ACTIVE",
      publishedAt: now.toISOString(),
      dueAt: null,
      canViewSubmissions: true,
      progress: { submittedCount: 10, cohortSize: 28 },
      attention: {
        pendingFeedbackCount: 2,
        pendingEvaluationCount: 3,
        awaitingResubmissionCount: 1,
      },
    },
  ],
};

const agentContext: CommandContext = {
  actorId,
  source: "AGENT",
  traceId: "insights-trace",
  clock: () => now,
};

function dashboard() {
  return {
    actor: { displayName: "林老师" },
    selectedReleaseId: releaseId,
    releaseOptions: [
      {
        id: releaseId,
        title: "校园节水行动",
        classroomName: "七年一班",
        status: "ACTIVE" as const,
        publishedAt: now.toISOString(),
      },
    ],
    rubric: [
      {
        releaseId,
        title: "校园节水行动",
        classroomName: "七年一班",
        status: "ready" as const,
        sampleCount: 12,
        dimensions: [
          { dimensionIndex: 1, dimensionName: "问题意识", excellent: 4, good: 5, pass: 2, improve: 1, insufficient: 0, weak: false },
          { dimensionIndex: 2, dimensionName: "证据质量", excellent: 1, good: 2, pass: 3, improve: 6, insufficient: 0, weak: true },
        ],
      },
    ],
    stages: [
      {
        releaseId,
        title: "校园节水行动",
        classroomName: "七年一班",
        audienceCount: 28,
        buckets: [
          { key: "not_started", label: "尚未开始", count: 6 },
          { key: "phase:1", label: "观察", count: 12 },
          { key: "complete", label: "全部完成", count: 10 },
        ],
      },
    ],
    improvement: {
      reviseCount: 5,
      resubmittedCount: 4,
      evaluationPairs: 3,
      rose: 2,
      unchanged: 1,
      fell: 0,
    },
  };
}

function database(): PrismaClient {
  return { kind: "insights-database" } as unknown as PrismaClient;
}

const getInsights = vi.fn();

function reader(source: TeacherActivityDashboard = workspace) {
  return createTeacherReleaseInsightsReader({
    database: database(),
    agentContext,
    workspace: source,
    getInsights: getInsights as never,
  });
}

describe("teacher release insights reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInsights.mockResolvedValue(dashboard());
  });

  it("returns the same aggregate the diagnostics page computes", async () => {
    const output = await reader()(releaseId);

    expect(output).toMatchObject({
      status: "FOUND",
      releaseId,
      title: "校园节水行动",
      classroomName: "七年一班",
      releaseStatus: "ACTIVE",
      insightsHref: "/teacher/insights",
      audienceCount: 28,
      rubricStatus: "ready",
      evaluatedCount: 12,
      improvement: { rose: 2, unchanged: 1, fell: 0 },
    });
    expect(getInsights).toHaveBeenCalledWith(expect.anything(), agentContext, {
      releaseId,
    });
  });

  it("marks the weakest rubric dimension without naming anyone", async () => {
    const output = await reader()(releaseId);

    expect(output.status === "FOUND" && output.rubricDimensions).toEqual([
      { dimensionName: "问题意识", excellent: 4, good: 5, pass: 2, improve: 1, insufficient: 0, weakest: false },
      { dimensionName: "证据质量", excellent: 1, good: 2, pass: 3, improve: 6, insufficient: 0, weakest: true },
    ]);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("studentId");
    expect(serialized).not.toContain("submissionId");
    expect(serialized).not.toContain("dimensionIndex");
  });

  it("does not query a release outside the authorized workspace", async () => {
    await expect(reader()(foreignReleaseId)).resolves.toEqual({
      status: "NOT_FOUND",
      releaseId: foreignReleaseId,
    });
    expect(getInsights).not.toHaveBeenCalled();
  });

  it("stays absent when the query no longer returns that release", async () => {
    getInsights.mockResolvedValue({
      ...dashboard(),
      releaseOptions: [],
      rubric: [],
      stages: [],
    });

    await expect(reader()(releaseId)).resolves.toEqual({
      status: "NOT_FOUND",
      releaseId,
    });
  });

  it("keeps a resource-level refusal indistinguishable from absence", async () => {
    getInsights.mockRejectedValue(new TeacherActivityQueryError("NOT_FOUND"));

    await expect(reader()(releaseId)).resolves.toEqual({
      status: "NOT_FOUND",
      releaseId,
    });
  });

  it("resolves one authorization decision per release in a request", async () => {
    const read = reader();

    const [first, second] = await Promise.all([
      read(releaseId),
      read(releaseId),
    ]);

    expect(first).toEqual(second);
    expect(getInsights).toHaveBeenCalledTimes(1);
  });

  it("propagates an infrastructure failure instead of reporting absence", async () => {
    getInsights.mockRejectedValue(new Error("database unavailable"));

    await expect(reader()(releaseId)).rejects.toThrow("database unavailable");
  });
});
