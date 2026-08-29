import { ZodError } from "zod";
import { attachmentDisposition } from "../../../../domain/submission/attachment-policy";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createSubmissionAttachmentDownload } from "../../../../server/attachments/submission-attachment-service";
import { SubmissionAttachmentAccessError } from "../../../../server/attachments/submission-attachment-access";
import { createAttachmentStorage } from "../../../../server/attachments/attachment-storage-factory";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const storage = createAttachmentStorage();
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
    const disposition = attachmentDisposition(attachment.mediaType);
    return new Response(stream, {
      headers: {
        "Content-Type": attachment.mediaType,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.originalFilename)}`,
        "X-Content-Type-Options": "nosniff",
        // Rendering a student's upload in place means running their bytes on our
        // own origin, and a PDF can carry script. `sandbox` with no tokens drops
        // the response into an opaque origin with scripting off, so an inline
        // view cannot reach this site's cookies or DOM. Sent on every response,
        // including downloads, because a download can still be opened in a tab.
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data: blob:; object-src 'none'",
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
