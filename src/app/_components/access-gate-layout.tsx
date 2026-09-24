import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 教师、学生、管理员三个登录门禁共用的版式（shadcn login-04 的两栏卡片）：
 * 左侧表单，右侧这个工作台是做什么的。窄屏只保留表单。
 */
export function AccessGateLayout({
  workspace,
  pitchTitle,
  pitchBody,
  steps,
  eyebrow,
  title,
  children,
}: {
  workspace: string;
  pitchTitle: string;
  pitchBody: string;
  steps: readonly string[];
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <Link
        aria-label="返回 CDAS Next 首页"
        className="flex items-center gap-2 font-medium"
        href="/"
      >
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
          CD
        </span>
        CDAS Next
      </Link>
      <Card className="w-full max-w-sm overflow-hidden p-0 md:max-w-3xl">
        <CardContent className="grid p-0 md:grid-cols-2">
          <main className="flex flex-col gap-6 p-6 md:p-8">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{eyebrow}</p>
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            </div>
            {children}
          </main>
          <section className="hidden flex-col justify-between gap-8 border-l bg-muted/50 p-8 md:flex">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{workspace}</p>
              <h1 className="text-2xl leading-snug font-semibold tracking-tight">
                {pitchTitle}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {pitchBody}
              </p>
            </div>
            <ol className="grid grid-cols-2 gap-3 text-sm">
              {steps.map((step, index) => (
                <li className="flex items-center gap-2" key={step}>
                  <span className="flex size-6 items-center justify-center rounded-full border text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </section>
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        AI 只帮忙准备内容，正式决定都由教师来做。
      </p>
    </div>
  );
}
