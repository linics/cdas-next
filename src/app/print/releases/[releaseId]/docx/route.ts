import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../../server/db/client";
import { getPrintableRelease } from "../../../../../server/queries/task-book-print";
import { docxResponse } from "../../../docx-response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ releaseId: string }> },
) {
  const { releaseId } = await params;
  return docxResponse(async () => {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    return getPrintableRelease(database, context, { releaseId });
  });
}
