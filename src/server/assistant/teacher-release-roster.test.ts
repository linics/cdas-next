import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import type { TeacherActivityDashboard } from "../queries/teacher-activity-workspace";
import { SubmissionWorkspaceQueryError } from "../queries/submission-workspace";
import {
  createTeacherReleaseRosterReader,
  RELEASE_ROSTER_MAX_OBJECTS,
} from "./teacher-release-roster";

vi.mock("server-only", () => ({}));

const actorId = "10000000-0000-4000-8000-000000000001";
const releaseId = "60000000-0000-4000-8000-000000000006";
const foreignReleaseId = "90000000-0000-4000-8000-000000000009";
const now = new Date("2026-08-29T04:00:00.000Z");

function uuid(seed: number): string {
  return `70000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

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
      progress: { submittedCount: 2, cohortSize: 3 },
      attention: {
        pendingFeedbackCount: 1,
        pendingEvaluationCount: 2,
        awaitingResubmissionCount: 0,
      },
    },
  ],
};

const agentContext: CommandContext = {
  actorId,
  source: "AGENT",
  traceId: "roster-trace",
  clock: () => now,
};

function submissionRow(seed: number, studentId: string) {
  return {
    submissionId: uuid(seed),
    phaseIndex: 1,
    phaseName: "观察与问题界定",
    student: { id: studentId, displayName: "陈同学" },
    group: null,
    currentRevision: {
      id: uuid(seed + 100),
      revisionNumber: 1,
      isLate: false,
      submittedAt: now.toISOString(),
      feedback: null,
      evaluation: null,
      followUp: null,
    },
  };
}

function rosterWorkspace(overrides?: {
  progressCount?: number;
  rubricAvailable?: boolean;
}) {
  const count = overrides?.progressCount ?? 2;
  const students = Array.from({ length: count }, (_, index) => uuid(index + 1));
  return {
    actor: { displayName: "林老师" },
    release: {
      id: releaseId,
      title: "校园节水行动",
      classroomName: "七年一班",
      status: "ACTIVE" as const,
      publishedAt: now.toISOString(),
      dueAt: null,
      executionVersion: 1,
      submissionMode: "phased" as const,
      phaseCount: 3,
      rubricAvailable: overrides?.rubricAvailable ?? true,
    },
    submissions: [submissionRow(1, students[0]!)],
    progress: students.map((id, index) => ({
      student: { id, displayName: `学生${index + 1}` },
      started: index === 0,
      completedPhaseCount: index === 0 ? 1 : 0,
      totalPhaseCount: 3,
      currentPhaseIndex: index === 0 ? 2 : 1,
      complete: false,
      awaitingFormalRevision: index !== 0,
      group: null,
    })),
    reviewCoverage: {
      currentRevisionCount: 1,
      feedbackCount: 0,
      evaluationCount: 0,
    },
  };
}

function database(): PrismaClient {
  return { kind: "roster-database" } as unknown as PrismaClient;
}

const getSubmissions = vi.fn();

function reader(source: TeacherActivityDashboard = workspace) {
  return createTeacherReleaseRosterReader({
    database: database(),
    agentContext,
    workspace: source,
    getSubmissions: getSubmissions as never,
  });
}

describe("teacher release roster reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSubmissions.mockResolvedValue(rosterWorkspace());
  });

  it("returns objects as ordinals with no display name anywhere", async () => {
    const output = await reader()(releaseId);

    expect(output).toMatchObject({
      status: "FOUND",
      releaseId,
      objectCount: 2,
      truncated: false,
      submissionsHref: `/teacher/releases/${releaseId}/submissions`,
    });
    expect(output.status === "FOUND" && output.objects[0]).toMatchObject({
      objectOrdinal: 1,
      objectKind: "STUDENT",
      started: true,
      currentPhaseIndex: 2,
    });
    // D-054 makes this a boundary of the decision, not a detail: no student
    // name, group name or any other display name may reach the model.
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("学生1");
    expect(serialized).not.toContain("陈同学");
    expect(serialized).not.toContain("displayName");
    expect(serialized).not.toContain("studentId");
    expect(serialized).not.toContain("submissionId");
  });

  it("gives each formal submission a canonical review link", async () => {
    const output = await reader()(releaseId);

    expect(
      output.status === "FOUND" && output.objects[0]?.submissions,
    ).toEqual([
      {
        phaseIndex: 1,
        phaseName: "观察与问题界定",
        revisionNumber: 1,
        isLate: false,
        feedback: "PENDING",
        feedbackVersion: null,
        evaluation: "PENDING",
        evaluationVersion: null,
        followUp: null,
        reviewHref: `/teacher/submissions/${uuid(1)}`,
      },
    ]);
    expect(
      output.status === "FOUND" && output.objects[1]?.submissions,
    ).toEqual([]);
  });

  it("marks evaluation unavailable when the snapshot froze no rubric", async () => {
    getSubmissions.mockResolvedValue(
      rosterWorkspace({ rubricAvailable: false }),
    );

    const output = await reader()(releaseId);

    expect(
      output.status === "FOUND" &&
        output.objects[0]?.submissions[0]?.evaluation,
    ).toBe("NO_RUBRIC");
  });

  it("does not query a release outside the authorized workspace", async () => {
    await expect(reader()(foreignReleaseId)).resolves.toEqual({
      status: "NOT_FOUND",
      releaseId: foreignReleaseId,
    });
    expect(getSubmissions).not.toHaveBeenCalled();
  });

  it("stops offering the roster once classroom management is lost", async () => {
    const revoked: TeacherActivityDashboard = {
      ...workspace,
      releases: workspace.releases.map((release) => ({
        ...release,
        canViewSubmissions: false,
        progress: null,
        attention: null,
      })),
    };

    await expect(reader(revoked)(releaseId)).resolves.toEqual({
      status: "NOT_FOUND",
      releaseId,
    });
    expect(getSubmissions).not.toHaveBeenCalled();
  });

  it("keeps a resource-level refusal indistinguishable from absence", async () => {
    getSubmissions.mockRejectedValue(
      new SubmissionWorkspaceQueryError("NOT_FOUND"),
    );

    await expect(reader()(releaseId)).resolves.toEqual({
      status: "NOT_FOUND",
      releaseId,
    });
  });

  it("truncates a cohort larger than one response should carry", async () => {
    getSubmissions.mockResolvedValue(rosterWorkspace({ progressCount: 75 }));

    const output = await reader()(releaseId);

    expect(output).toMatchObject({
      status: "FOUND",
      objectCount: 75,
      truncated: true,
    });
    expect(output.status === "FOUND" && output.objects).toHaveLength(
      RELEASE_ROSTER_MAX_OBJECTS,
    );
    expect(
      output.status === "FOUND" && output.objects.at(-1)?.objectOrdinal,
    ).toBe(RELEASE_ROSTER_MAX_OBJECTS);
  });

  it("resolves one authorization decision per release in a request", async () => {
    const read = reader();

    const [first, second] = await Promise.all([
      read(releaseId),
      read(releaseId),
    ]);

    expect(first).toEqual(second);
    expect(getSubmissions).toHaveBeenCalledTimes(1);
  });

  it("propagates an infrastructure failure instead of reporting absence", async () => {
    getSubmissions.mockRejectedValue(new Error("database unavailable"));

    await expect(reader()(releaseId)).rejects.toThrow("database unavailable");
  });
});
