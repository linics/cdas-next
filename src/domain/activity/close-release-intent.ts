import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";

export const CLOSE_RELEASE_INTENT_TTL_MS = 10 * 60 * 1_000;

export const closeReleasePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseId: z.uuid(),
    expectedStatus: z.literal("ACTIVE"),
  })
  .strict();

const closeReleaseInputSchema = z
  .object({
    releaseId: z.uuid(),
    expectedStatus: z.literal("ACTIVE"),
  })
  .strict();

export type CloseReleasePayload = z.infer<typeof closeReleasePayloadSchema>;

export type CloseReleaseContext = {
  actor: { id: string; role: "TEACHER" | "STUDENT" };
  release: {
    id: string;
    publisherId: string;
    status: "ACTIVE" | "CLOSED" | "ARCHIVED";
  };
  classroom: { managerId: string };
  now: Date;
};

export type PreparedCloseReleaseIntent = {
  id: string;
  actionName: "close_activity_release";
  payload: CloseReleasePayload;
  payloadHash: string;
  expiresAt: Date;
};

export class CloseReleaseIntentError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "RELEASE_NOT_ACTIVE") {
    super(code);
    this.name = "CloseReleaseIntentError";
  }
}

export function createCloseReleasePayload(
  rawInput: unknown,
): CloseReleasePayload {
  const input = closeReleaseInputSchema.parse(rawInput);
  return closeReleasePayloadSchema.parse({ schemaVersion: 1, ...input });
}

export function hashCloseReleasePayload(rawPayload: unknown): string {
  const payload = closeReleasePayloadSchema.parse(rawPayload);
  const canonicalPayload = canonicalize(payload);
  if (canonicalPayload === undefined) {
    throw new TypeError("Close-release payload cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalPayload).digest("hex");
}

export function prepareCloseReleaseIntent(
  rawInput: unknown,
  context: CloseReleaseContext,
): PreparedCloseReleaseIntent {
  const payload = createCloseReleasePayload(rawInput);
  const isAuthorizedPublisher =
    context.actor.role === "TEACHER" &&
    context.release.id === payload.releaseId &&
    context.release.publisherId === context.actor.id &&
    context.classroom.managerId === context.actor.id;

  if (!isAuthorizedPublisher) {
    throw new CloseReleaseIntentError("FORBIDDEN");
  }
  if (
    payload.expectedStatus !== "ACTIVE" ||
    context.release.status !== payload.expectedStatus
  ) {
    throw new CloseReleaseIntentError("RELEASE_NOT_ACTIVE");
  }

  return {
    id: randomUUID(),
    actionName: "close_activity_release",
    payload,
    payloadHash: hashCloseReleasePayload(payload),
    expiresAt: new Date(context.now.getTime() + CLOSE_RELEASE_INTENT_TTL_MS),
  };
}
