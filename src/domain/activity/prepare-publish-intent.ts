import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";

export const publishDueAtSchema = z
  .iso.datetime({ offset: true })
  .refine((value) => {
    const fractionalSeconds = /\.([0-9]+)(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.exec(
      value,
    )?.[1];
    return fractionalSeconds === undefined || fractionalSeconds.length <= 3;
  }, "Due date precision must not exceed milliseconds");

export const publishRequestSchema = z
  .object({
    draftId: z.uuid(),
    expectedDraftVersion: z.int().positive(),
    classroomId: z.uuid(),
    dueAt: publishDueAtSchema.nullable(),
  })
  .strict();

export type PublishRequest = z.infer<typeof publishRequestSchema>;

export type PublishContext = {
  actor: { id: string; role: "TEACHER" | "STUDENT" };
  draft: {
    id: string;
    ownerId: string;
    version: number;
    status: "EDITING" | "READY_FOR_PREVIEW" | "SEALED";
  };
  classroom: { id: string; managerId: string };
  now: Date;
};

export type PreparedPublishIntent = {
  id: string;
  actionName: "publish_activity_release";
  payload: PublishRequest;
  payloadHash: string;
  expectedVersion: number;
  expiresAt: Date;
};

export class PublishIntentError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "DRAFT_NOT_READY"
      | "STALE_VERSION"
      | "DUE_DATE_EXPIRED",
  ) {
    super(code);
    this.name = "PublishIntentError";
  }
}

export function hashPublishRequest(input: unknown): string {
  const payload = publishRequestSchema.parse(input);
  const canonicalPayload = canonicalize(payload);
  if (canonicalPayload === undefined) {
    throw new TypeError("Publish payload cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalPayload).digest("hex");
}

export function preparePublishIntent(
  input: unknown,
  context: PublishContext,
): PreparedPublishIntent {
  const payload = publishRequestSchema.parse(input);

  const ownsDraft =
    context.actor.role === "TEACHER" &&
    context.draft.ownerId === context.actor.id;
  const managesClassroom = context.classroom.managerId === context.actor.id;
  const targetsLoadedResources =
    context.draft.id === payload.draftId &&
    context.classroom.id === payload.classroomId;

  if (!ownsDraft || !managesClassroom || !targetsLoadedResources) {
    throw new PublishIntentError("FORBIDDEN");
  }

  if (context.draft.status !== "READY_FOR_PREVIEW") {
    throw new PublishIntentError("DRAFT_NOT_READY");
  }

  if (context.draft.version !== payload.expectedDraftVersion) {
    throw new PublishIntentError("STALE_VERSION");
  }

  if (payload.dueAt && new Date(payload.dueAt) <= context.now) {
    throw new PublishIntentError("DUE_DATE_EXPIRED");
  }

  const payloadHash = hashPublishRequest(payload);

  return {
    id: randomUUID(),
    actionName: "publish_activity_release",
    payload,
    payloadHash,
    expectedVersion: payload.expectedDraftVersion,
    expiresAt: new Date(context.now.getTime() + 10 * 60 * 1_000),
  };
}
