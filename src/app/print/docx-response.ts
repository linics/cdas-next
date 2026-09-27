import "server-only";

import { ZodError } from "zod";
import { AuthenticationError } from "../../server/auth/current-actor";
import { buildTaskBookDocx } from "../../server/export/task-book-docx";
import {
  TaskBookPrintError,
  type PrintableTaskBook,
} from "../../server/queries/task-book-print";
import { TeacherActivityQueryError } from "../../server/queries/teacher-activity-workspace";

function fileName(taskBook: PrintableTaskBook): string {
  const suffix = taskBook.kind === "DRAFT" ? `草稿第${taskBook.version}版` : "发布版";
  return `${taskBook.content.title.replace(/[\\/:*?"<>|]/g, "_")}-${suffix}.docx`;
}

/**
 * Run an authorized read and answer with the Word file (D-074). Errors carry
 * no detail: an unauthorized or absent task book is simply not found.
 */
export async function docxResponse(read: () => Promise<PrintableTaskBook>): Promise<Response> {
  let taskBook: PrintableTaskBook;
  try {
    taskBook = await read();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return new Response("请先登录。", { status: 401 });
    }
    if (error instanceof TaskBookPrintError && error.code === "UNSUPPORTED_SCHEMA") {
      return new Response("旧版任务书暂不支持导出。", { status: 409 });
    }
    if (
      error instanceof TaskBookPrintError ||
      error instanceof TeacherActivityQueryError ||
      error instanceof ZodError
    ) {
      return new Response("未找到。", { status: 404 });
    }
    throw error;
  }
  const buffer = await buildTaskBookDocx(taskBook);
  const name = fileName(taskBook);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="task-book.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
