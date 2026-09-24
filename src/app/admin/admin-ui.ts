import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** shadcn 的按钮类要先合并冲突（基础类里的透明边框会盖掉描边色），和 <Button> 内部一致。 */
const button = (...args: Parameters<typeof buttonVariants>) =>
  cn(buttonVariants(...args));

/**
 * 管理员页面（概览、学校、教师）共用的版式。只用 Tailwind 语义类，
 * 颜色来自主题 token；按钮取 shadcn 的 buttonVariants。
 */
const card = "rounded-xl border bg-card text-card-foreground shadow-xs";

export const styles = {
  pageHeader:
    "mx-auto flex w-full max-w-6xl flex-col gap-1 pb-6 [&_h1]:type-page-title [&_p:last-child]:max-w-2xl [&_p:last-child]:text-sm [&_p:last-child]:text-muted-foreground",
  eyebrow: "text-xs font-medium text-muted-foreground",
  stats:
    "mx-auto grid w-full max-w-6xl grid-cols-2 gap-4 pb-6 lg:grid-cols-4",
  stat: `${card} flex flex-col gap-1 p-4 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:text-3xl [&_dd]:font-semibold [&_dd]:tabular-nums`,
  stack: "mx-auto flex w-full max-w-6xl flex-col gap-6",
  form: `${card} grid gap-4 p-5 [&_h2]:text-base [&_h2]:font-semibold`,
  field:
    "grid gap-1.5 [&_label]:text-sm [&_label]:font-medium [&_input]:h-9 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-transparent [&_input]:px-3 [&_input]:text-sm [&_input]:shadow-xs [&_select]:h-9 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:px-3 [&_select]:text-sm [&_select]:shadow-xs [&_input:focus-visible]:border-ring [&_input:focus-visible]:ring-[3px] [&_input:focus-visible]:ring-ring/50 [&_input:focus-visible]:outline-none [&_select:focus-visible]:border-ring [&_select:focus-visible]:ring-[3px] [&_select:focus-visible]:ring-ring/50 [&_select:focus-visible]:outline-none",
  actions: "flex flex-wrap gap-2",
  primaryButton: button(),
  secondaryButton: button({ variant: "outline" }),
  dangerButton: button({ variant: "destructive" }),
  table:
    "w-full caption-bottom text-sm [&_th]:h-10 [&_th]:px-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:px-2 [&_td]:py-2.5 [&_td]:tabular-nums [&_tr]:border-b [&_tbody_tr:hover]:bg-muted/50 [&_tbody_tr:last-child]:border-0",
  invite:
    "rounded-lg border bg-muted/40 px-4 py-3 font-mono text-sm break-all",
} as const;
