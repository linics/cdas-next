import { ZodError, z } from "zod";
import { MAX_ATTACHMENT_BYTES } from "../../../domain/submission/attachment-policy";
import { createServerReceivedAttachmentStorage } from "../../../server/attachments/attachment-storage-factory";
import {
  SubmissionAttachmentAccessError,
  getWritableSubmissionAttachmentStorageRecord,
} from "../../../server/attachments/submission-attachment-access";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";

const attachmentIdSchema = z.uuid();
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/**
 * The self-hosted upload path: with no Blob to presign against, the bytes come
 * through here.
 *
 * This route only writes the object. It does not move the attachment's state —
 * the existing finalize step still reads back what landed and compares it to the
 * reservation, so an upload that does not match what was reserved is caught by
 * the same check that guards the Blob path.
 */
export async function POST(request: Request) {
  const storage = createServerReceivedAttachmentStorage();
  if (!storage) {
    return Response.json(
      { error: "ATTACHMENT_STORAGE_UNAVAILABLE" },
      { status: 503 },
    );
  }
  try {
    const commandContext = await createUiCommandContext();
    const contentLength = Number(request.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_ATTACHMENT_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
    ) {
      return Response.json({ error: "ATTACHMENT_TOO_LARGE" }, { status: 413 });
    }
    const form = await request.formData();
    const attachmentId = attachmentIdSchema.parse(form.get("attachmentId"));
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "ATTACHMENT_FILE_REQUIRED" }, { status: 400 });
    }
    // request.formData() has materialized the file by this point. The header
    // guard above rejects ordinary oversized multipart requests before that;
    // this check remains authoritative for the parsed file itself.
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return Response.json({ error: "ATTACHMENT_TOO_LARGE" }, { status: 413 });
    }

    const attachment = await getWritableSubmissionAttachmentStorageRecord(
      getDatabaseClient(),
      commandContext,
      { attachmentId },
    );
    if (attachment.status !== "UPLOAD_PENDING") {
      throw new SubmissionAttachmentAccessError("NOT_FOUND");
    }
    if (file.size !== attachment.byteSize) {
      return Response.json({ error: "ATTACHMENT_OBJECT_MISMATCH" }, { status: 409 });
    }

    // The reserved media type is written to the sidecar, not the browser's
    // claim: the browser has already been believed once, at reservation, and
    // believing it again here would let the two disagree.
    await storage.putObject(
      attachment.storageKey,
      new Uint8Array(await file.arrayBuffer()),
      attachment.mediaType,
    );
    return Response.json({ attachmentId });
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      error instanceof SubmissionAttachmentAccessError ||
      error instanceof ZodError
    ) {
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json(
      { error: "ATTACHMENT_STORAGE_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
