"use client";

import type { ReactNode } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 反馈与评价两个撰写区共用的结果提示：成功、冲突（可刷新）、失败。 */
export function ReviewNotice({
  tone,
  message,
  onRefresh,
}: {
  tone: "success" | "conflict" | "error";
  message: string;
  onRefresh?: () => void;
}) {
  const Icon =
    tone === "success"
      ? CircleCheckIcon
      : tone === "conflict"
        ? RefreshCwIcon
        : CircleAlertIcon;
  return (
    <Alert
      aria-live="polite"
      role={tone === "success" ? "status" : "alert"}
      variant={tone === "error" ? "destructive" : "default"}
    >
      <Icon />
      <AlertDescription>{message}</AlertDescription>
      {onRefresh ? (
        <AlertAction>
          <Button onClick={onRefresh} size="sm" type="button" variant="outline">
            刷新
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

/** 撰写区外框：标题 + 副标题 + 右上角的模式标签与 AI 起草按钮。 */
export function ComposerFrame({
  titleId,
  title,
  lead,
  assistantEnabled,
  suggestion,
  busy,
  children,
}: {
  titleId: string;
  title: string;
  lead: ReactNode;
  assistantEnabled: boolean;
  suggestion?: ReactNode;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-busy={busy}
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-xs"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold" id={titleId}>
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">{lead}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {assistantEnabled ? "教师终审 · AI 可选" : "手动撰写 · 未启用 AI"}
          </Badge>
          {suggestion}
        </div>
      </header>
      {children}
    </section>
  );
}

export function AiNote({ children }: { children: ReactNode }) {
  return (
    <p
      className="flex gap-2 rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground"
      role="note"
    >
      <SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </p>
  );
}

/** 字段标题行：左边标签，右边字数（超限时变红）。 */
export function FieldHead({
  htmlFor,
  label,
  countId,
  count,
  overLimit,
}: {
  htmlFor: string;
  label: string;
  countId: string;
  count: number;
  overLimit: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      <span
        className={cn(
          "text-xs tabular-nums text-muted-foreground",
          overLimit && "font-medium text-destructive",
        )}
        data-over-limit={overLimit ? "true" : "false"}
        id={countId}
      >
        {count.toLocaleString("zh-CN")} / 10,000
      </span>
    </div>
  );
}

export function PrepareRow({
  note,
  children,
}: {
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">{note}</p>
      {children}
    </div>
  );
}
