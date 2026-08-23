import { ZodError } from "zod";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createSubmissionAttachmentDownload } from "../../../../server/attachments/submission-attachment-service";
import { SubmissionAttachmentAccessError } from "../../../../server/attachments/submission-attachment-access";
import { createAttachmentStorageFromEnvironment } from "../../../../server/attachments/vercel-blob-attachment-storage";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const storage = createAttachmentStorageFromEnvironment();
  if (!storage) {
    return Response.json(
      { error: "ATTACHMENT_STORAGE_UNAVAILABLE" },
      { status: 503 },
    );
  }
  try {
    const { attachmentId } = await params;
    const { attachment, stream } = await createSubmissionAttachmentDownload(
      getDatabaseClient(),
      storage,
      await createUiCommandContext(),
      attachmentId,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": attachment.mediaType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.originalFilename)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      error instanceof SubmissionAttachmentAccessError ||
      error instanceof ZodError
    ) {
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    throw error;
  }
}
