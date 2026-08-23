import { describe, expect, it } from "vitest";
import {
  preparePublishIntent,
  PublishIntentError,
  type PublishContext,
} from "./prepare-publish-intent";

const teacherId = "00000000-0000-4000-8000-000000000001";
const otherTeacherId = "00000000-0000-4000-8000-000000000002";
const draftId = "00000000-0000-4000-8000-000000000010";
const classroomId = "00000000-0000-4000-8000-000000000020";
const now = new Date("2026-08-18T10:00:00.000Z");

const request = {
  draftId,
  expectedDraftVersion: 7,
  classroomId,
  dueAt: "2026-08-31T15:59:59.000+08:00",
};

function context(overrides: Partial<PublishContext> = {}): PublishContext {
  return {
    actor: { id: teacherId, role: "TEACHER" },
    draft: {
      id: draftId,
      ownerId: teacherId,
      version: 7,
      status: "READY_FOR_PREVIEW",
    },
    classroom: { id: classroomId, managerId: teacherId },
    now,
    ...overrides,
  };
}

describe("preparePublishIntent", () => {
  it("binds the exact draft version and expires after ten minutes", () => {
    const intent = preparePublishIntent(request, context());

    expect(intent.actionName).toBe("publish_activity_release");
    expect(intent.expectedVersion).toBe(7);
    expect(intent.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(intent.expiresAt.toISOString()).toBe("2026-08-18T10:10:00.000Z");
  });

  it("produces the same hash for semantically identical payloads", () => {
    const reordered = {
      classroomId,
      dueAt: request.dueAt,
      expectedDraftVersion: 7,
      draftId,
    };

    expect(preparePublishIntent(reordered, context()).payloadHash).toBe(
      preparePublishIntent(request, context()).payloadHash,
    );
  });

  it("rejects a teacher who does not own the resources", () => {
    expect(() =>
      preparePublishIntent(
        request,
        context({ actor: { id: otherTeacherId, role: "TEACHER" } }),
      ),
    ).toThrow(new PublishIntentError("FORBIDDEN"));
  });

  it("rejects a stale preview", () => {
    expect(() =>
      preparePublishIntent(
        request,
        context({
          draft: {
            id: draftId,
            ownerId: teacherId,
            version: 8,
            status: "READY_FOR_PREVIEW",
          },
        }),
      ),
    ).toThrow(new PublishIntentError("STALE_VERSION"));
  });

  it("rejects an expired due date", () => {
    expect(() =>
      preparePublishIntent(
        { ...request, dueAt: "2026-08-18T09:59:59.000Z" },
        context(),
      ),
    ).toThrow(new PublishIntentError("DUE_DATE_EXPIRED"));
  });

  it("rejects due dates that the database cannot preserve exactly", () => {
    expect(() =>
      preparePublishIntent(
        { ...request, dueAt: "2026-08-31T15:59:59.123456+08:00" },
        context(),
      ),
    ).toThrow(/precision must not exceed milliseconds/);

    expect(() =>
      preparePublishIntent(
        { ...request, dueAt: "2026-08-31 15:59:59" },
        context(),
      ),
    ).toThrow();
  });
});
