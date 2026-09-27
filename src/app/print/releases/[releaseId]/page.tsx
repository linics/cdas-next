import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  getPrintableRelease,
  TaskBookPrintError,
} from "../../../../server/queries/task-book-print";
import { TeacherActivityQueryError } from "../../../../server/queries/teacher-activity-workspace";
import { TeacherAccessGate } from "../../../teacher/_components/teacher-shell";
import { TaskBookSheet } from "../../task-book-sheet";
import { UnsupportedPrint } from "../../unsupported-print";

export default async function PrintReleasePage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  const backHref = `/teacher/releases/${releaseId}/submissions`;
  let taskBook;
  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    taskBook = await getPrintableRelease(database, context, { releaseId });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <TeacherAccessGate code={error.code} returnPath={`/print/releases/${releaseId}`} />;
    }
    if (error instanceof TaskBookPrintError && error.code === "UNSUPPORTED_SCHEMA") {
      return <UnsupportedPrint backHref={backHref} />;
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
  return <TaskBookSheet backHref={backHref} docxHref={`/print/releases/${releaseId}/docx`} taskBook={taskBook} />;
}
