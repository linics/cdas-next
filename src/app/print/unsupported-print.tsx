import Link from "next/link";
import { Button } from "@/components/ui/button";

/** v1/v2 task books keep their web reading view; no print layout is claimed. */
export function UnsupportedPrint({ backHref }: { backHref: string }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-16">
      <h1 className="type-page-title">暂不支持打印旧版任务书</h1>
      <p className="type-body text-muted-foreground">
        打印视图只支持新版任务书。旧版内容请在网页中查看。
      </p>
      <Button asChild className="w-fit" variant="outline">
        <Link href={backHref}>返回</Link>
      </Button>
    </main>
  );
}
