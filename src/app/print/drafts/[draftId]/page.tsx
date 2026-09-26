import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  getPrintableDraftRevision,
  TaskBookPrintError,
} from "../../../../server/queries/task-book-print";
import { TeacherActivityQueryError } from "../../../../server/queries/teacher-activity-workspace";
import { TeacherAccessGate } from "../../../teacher/_components/teacher-shell";
import { TaskBookSheet } from "../../task-book-sheet";
import { UnsupportedPrint } from "../../unsupported-print";

export default async function PrintDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams?: Promise<{ version?: string | string[] }>;
}) {
  const { draftId } = await params;
  const versionText = (await searchParams)?.version;
  const version =
    typeof versionText === "string" && /^\d{1,6}$/.test(versionText)
      ? Number(versionText)
      : undefined;
  let taskBook;
  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    taskBook = await getPrintableDraftRevision(database, context, {
      draftId,
      version,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <TeacherAccessGate code={error.code} returnPath={`/print/drafts/${draftId}`} />;
    }
    if (error instanceof TaskBookPrintError && error.code === "UNSUPPORTED_SCHEMA") {
      return <UnsupportedPrint backHref={`/teacher/activities/${draftId}`} />;
    }
    if (
      error instanceof TaskBookPrintError ||
      error instanceof TeacherActivityQueryError ||
      error instanceof ZodError
    ) {
      notFound();
    }
    throw error;
  }
  return <TaskBookSheet backHref={`/teacher/activities/${draftId}`} taskBook={taskBook} />;
}
