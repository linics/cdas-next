import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../../server/db/client";
import { getPrintableDraftRevision } from "../../../../../server/queries/task-book-print";
import { docxResponse } from "../../../docx-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params;
  const versionText = new URL(request.url).searchParams.get("version");
  const version =
    versionText && /^\d{1,6}$/.test(versionText) ? Number(versionText) : undefined;
  return docxResponse(async () => {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    return getPrintableDraftRevision(database, context, { draftId, version });
  });
}
