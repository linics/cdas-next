import { ZodError } from "zod";
import { AuthenticationError } from "../../../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../../../server/db/client";
import {
  getTeacherReleaseSubmissions,
  SubmissionWorkspaceQueryError,
} from "../../../../../../server/queries/submission-workspace";
import {
  formatTeacherReviewRosterCsv,
  teacherReviewRosterCsvFilename,
} from "../../../../../../server/queries/teacher-review-roster-csv";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ releaseId: string }> },
) {
  try {
    const { releaseId } = await params;
    const context = await createUiCommandContext();
    const workspace = await getTeacherReleaseSubmissions(
      getDatabaseClient(),
      context,
      { releaseId },
    );
    const filename = teacherReviewRosterCsvFilename(workspace.release.title);
    return new Response(formatTeacherReviewRosterCsv(workspace), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="review-roster.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      error instanceof SubmissionWorkspaceQueryError ||
      error instanceof ZodError
    ) {
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    throw error;
  }
}
