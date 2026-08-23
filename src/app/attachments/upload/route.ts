import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { ZodError, z } from "zod";
import { AuthenticationError } from "../../../server/auth/current-actor";
import { createAttachmentStorageFromEnvironment } from "../../../server/attachments/vercel-blob-attachment-storage";
import {
  SubmissionAttachmentAccessError,
  getWritableSubmissionAttachmentStorageRecord,
} from "../../../server/attachments/submission-attachment-access";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";

const attachmentIdSchema = z.uuid();
const uploadTtlMilliseconds = 5 * 60 * 1_000;

function unavailable() {
  return Response.json(
    { error: "ATTACHMENT_STORAGE_UNAVAILABLE" },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  if (!createAttachmentStorageFromEnvironment()) {
    return unavailable();
  }
  try {
    const body = (await request.json()) as HandleUploadPresignedBody;
    const response = await handleUploadPresigned({
      body,
      request,
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY,
      getSignedToken: async (pathname, clientPayload) => {
        const attachmentId = attachmentIdSchema.parse(clientPayload);
        const attachment = await getWritableSubmissionAttachmentStorageRecord(
          getDatabaseClient(),
          await createUiCommandContext(),
          { attachmentId },
        );
        if (
          attachment.status !== "UPLOAD_PENDING" ||
          pathname !== attachment.storageKey
        ) {
          throw new SubmissionAttachmentAccessError("NOT_FOUND");
        }
        return {
          token: await issueSignedToken({
            pathname,
            operations: ["put"],
            allowedContentTypes: [attachment.mediaType],
            maximumSizeInBytes: attachment.byteSize,
            validUntil: Date.now() + uploadTtlMilliseconds,
            storeId: process.env.BLOB_STORE_ID,
          }),
          urlOptions: {
            addRandomSuffix: false,
            allowOverwrite: false,
            cacheControlMaxAge: 60,
          },
        };
      },
    });
    return Response.json(response);
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      error instanceof SubmissionAttachmentAccessError ||
      error instanceof ZodError
    ) {
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return unavailable();
  }
}
