import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  teacherActivityPreviewSchema,
  teacherDashboardSchema,
  teacherPublishConfirmationSchema,
} from "./teacher-activity-workspace";

const draftId = "10000000-0000-4000-8000-000000000001";
const revisionId = "20000000-0000-4000-8000-000000000002";
const classroomId = "30000000-0000-4000-8000-000000000003";
const intentId = "40000000-0000-4000-8000-000000000004";
const instant = "2026-08-20T04:00:00.000Z";
const content = {
  schemaVersion: 1 as const,
  title: "校園節水",
  summary: "記錄並解釋用水變化",
  learningObjectives: ["用資料支持結論"],
  taskInstructions: "記錄兩次讀數。",
  evidenceRequirements: ["讀數與時間"],
  feedbackCriteria: ["證據與結論一致"],
};
const draft = {
  id: draftId,
  status: "READY_FOR_PREVIEW" as const,
  version: 1,
  updatedAt: instant,
  sealedAt: null,
  releaseId: null,
  revision: {
    id: revisionId,
    version: 1,
    source: "MANUAL" as const,
    createdAt: instant,
    content,
  },
};

describe("teacher workspace output contracts", () => {
  it("rejects extra fields at every exposed DTO boundary", () => {
    const dashboard = {
      actor: { displayName: "林老師" },
      drafts: [
        {
          id: draftId,
          title: content.title,
          status: "READY_FOR_PREVIEW" as const,
          version: 1,
          updatedAt: instant,
          releaseId: null,
        },
      ],
      releases: [
        {
          id: revisionId,
          title: content.title,
          classroomName: "七年一班",
          status: "ACTIVE" as const,
          publishedAt: instant,
          dueAt: null,
          canViewSubmissions: true,
          attention: {
            pendingFeedbackCount: 0,
            pendingEvaluationCount: 0,
            awaitingResubmissionCount: 0,
          },
        },
      ],
      classrooms: [
        { id: classroomId, name: "七年一班", currentMemberCount: 1 },
      ],
    };
    const preview = {
      actor: { displayName: "林老師" },
      draft,
      classrooms: dashboard.classrooms,
    };
    const confirmation = {
      actionIntentId: intentId,
      status: "PREPARED" as const,
      draftId,
      draftVersion: 1,
      classroom: { id: classroomId, name: "七年一班" },
      dueAt: null,
      payloadHash: "a".repeat(64),
      expiresAt: instant,
      content,
    };

    expect(teacherDashboardSchema.safeParse(dashboard).success).toBe(true);
    expect(teacherActivityPreviewSchema.safeParse(preview).success).toBe(true);
    expect(
      teacherPublishConfirmationSchema.safeParse(confirmation).success,
    ).toBe(true);

    expect(
      teacherDashboardSchema.safeParse({
        ...dashboard,
        actor: { ...dashboard.actor, authSubject: "must-not-strip" },
      }).success,
    ).toBe(false);
    expect(
      teacherDashboardSchema.safeParse({
        ...dashboard,
        releases: [
          { ...dashboard.releases[0], internalVersion: 7 },
        ],
      }).success,
    ).toBe(false);
    expect(
      teacherActivityPreviewSchema.safeParse({
        ...preview,
        draft: {
          ...draft,
          revision: { ...draft.revision, agentRunId: "must-not-strip" },
        },
      }).success,
    ).toBe(false);
    expect(
      teacherPublishConfirmationSchema.safeParse({
        ...confirmation,
        classroom: {
          ...confirmation.classroom,
          managerId: "must-not-strip",
        },
      }).success,
    ).toBe(false);
  });
});
