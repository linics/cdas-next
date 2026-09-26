import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LocalizedDateTime } from "../_components/localized-date-time";
import { TaskBookV3View } from "../_components/task-book-v3-view";
import type { PrintableTaskBook } from "../../server/queries/task-book-print";
import { PrintButton } from "./print-button";

/**
 * A plain A4 task book for class or 教研 (D-071): the same renderer as the
 * preview and student pages, set as a document rather than a glass card.
 * No student data, no controls in the printout.
 */
export function TaskBookSheet({
  taskBook,
  backHref,
}: {
  taskBook: PrintableTaskBook;
  backHref: string;
}) {
  const { content } = taskBook;
  return (
    <main className="mx-auto w-full max-w-[210mm] bg-white px-8 py-10 text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3" data-print="hide">
        <Button asChild variant="outline">
          <Link href={backHref}>返回</Link>
        </Button>
        <PrintButton />
      </div>
      <header className="mb-6 border-b border-black/30 pb-4">
        <p className="text-sm text-black/70">
          {taskBook.kind === "DRAFT" ? (
            <>
              草稿 · 第 {taskBook.version} 版 · 保存于{" "}
              <LocalizedDateTime dateTime={taskBook.datedAt} />
            </>
          ) : (
            <>
              已发布 · {taskBook.classroomName} · 发布于{" "}
              <LocalizedDateTime dateTime={taskBook.datedAt} />
              {taskBook.dueAt ? (
                <>
                  {" · 截止 "}
                  <LocalizedDateTime dateTime={taskBook.dueAt} />
                </>
              ) : null}
              {` · 来自草稿第 ${taskBook.version} 版`}
            </>
          )}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{content.title}</h1>
        <p className="mt-2 leading-7">{content.summary}</p>
      </header>
      <article className="print-sheet leading-7 [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6">
        <TaskBookV3View content={content} />
      </article>
    </main>
  );
}
