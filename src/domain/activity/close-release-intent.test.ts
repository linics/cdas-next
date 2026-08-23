import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CLOSE_RELEASE_INTENT_TTL_MS,
  CloseReleaseIntentError,
  createCloseReleasePayload,
  hashCloseReleasePayload,
  prepareCloseReleaseIntent,
} from "./close-release-intent";

function fixture() {
  const teacherId = randomUUID();
  const releaseId = randomUUID();
  const now = new Date("2026-08-20T08:00:00.000Z");
  return {
    input: { releaseId, expectedStatus: "ACTIVE" as const },
    context: {
      actor: { id: teacherId, role: "TEACHER" as const },
      release: {
        id: releaseId,
        publisherId: teacherId,
        status: "ACTIVE" as const,
      },
      classroom: { managerId: teacherId },
      now,
    },
  };
}

describe("close release intent", () => {
  it("binds the exact active release for ten minutes", () => {
    const { input, context } = fixture();
    const prepared = prepareCloseReleaseIntent(input, context);

    expect(prepared.actionName).toBe("close_activity_release");
    expect(prepared.payload).toEqual({ schemaVersion: 1, ...input });
    expect(prepared.payloadHash).toBe(
      hashCloseReleasePayload(prepared.payload),
    );
    expect(prepared.expiresAt.getTime()).toBe(
      context.now.getTime() + CLOSE_RELEASE_INTENT_TTL_MS,
    );
  });

  it("hashes canonical payloads deterministically and binds every field", () => {
    const { input } = fixture();
    const payload = createCloseReleasePayload(input);
    const reordered = {
      expectedStatus: payload.expectedStatus,
      releaseId: payload.releaseId,
      schemaVersion: payload.schemaVersion,
    };

    expect(hashCloseReleasePayload(reordered)).toBe(
      hashCloseReleasePayload(payload),
    );
    expect(
      hashCloseReleasePayload({ ...payload, releaseId: randomUUID() }),
    ).not.toBe(hashCloseReleasePayload(payload));
  });

  it("rejects students, another publisher, and a lost classroom manager", () => {
    const { input, context } = fixture();

    expect(() =>
      prepareCloseReleaseIntent(input, {
        ...context,
        actor: { ...context.actor, role: "STUDENT" },
      }),
    ).toThrow(new CloseReleaseIntentError("FORBIDDEN"));
    expect(() =>
      prepareCloseReleaseIntent(input, {
        ...context,
        release: { ...context.release, publisherId: randomUUID() },
      }),
    ).toThrow(new CloseReleaseIntentError("FORBIDDEN"));
    expect(() =>
      prepareCloseReleaseIntent(input, {
        ...context,
        classroom: { managerId: randomUUID() },
      }),
    ).toThrow(new CloseReleaseIntentError("FORBIDDEN"));
  });

  it("rejects a release that is no longer active and widened input", () => {
    const { input, context } = fixture();

    expect(() =>
      prepareCloseReleaseIntent(input, {
        ...context,
        release: { ...context.release, status: "CLOSED" },
      }),
    ).toThrow(new CloseReleaseIntentError("RELEASE_NOT_ACTIVE"));
    expect(() =>
      createCloseReleasePayload({
        ...input,
        actorId: context.actor.id,
      }),
    ).toThrow();
    expect(() =>
      createCloseReleasePayload({ ...input, expectedStatus: "CLOSED" }),
    ).toThrow();
  });
});
