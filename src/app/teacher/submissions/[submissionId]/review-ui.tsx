"use client";

import type { ReactNode } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
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
      className="flex flex-col gap-4 glass rounded-2xl p-4 text-card-foreground"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold" id={titleId}>
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">{lead}</p>
        </div>
        {assistantEnabled ? suggestion : null}
      </header>
      {children}
    </section>
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

/**
 * 一排可点的选项，代替「先点开下拉框再选」。底下仍是原生单选框，
 * 表单提交、键盘方向键和读屏都按单选组工作。
 */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
  required,
  size = "default",
  className,
  detached = false,
}: {
  legend: ReactNode;
  name: string;
  value: T | "";
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  required?: boolean;
  size?: "default" | "sm";
  className?: string;
  /**
   * Keep the radios out of the surrounding form's payload when the value
   * travels another way (the server actions accept an exact field set).
   */
  detached?: boolean;
}) {
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              className={cn(
                "inline-flex cursor-pointer items-center rounded-lg border bg-background px-3 text-sm transition-colors select-none hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
                size === "sm" ? "h-7 px-2.5 text-xs" : "h-9",
                checked &&
                  "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
              )}
              key={option.value}
              title={option.hint}
            >
              <input
                checked={checked}
                className="sr-only"
                disabled={disabled}
                form={detached ? `${name}-detached` : undefined}
                name={name}
                onChange={() => onChange(option.value)}
                required={required}
                type="radio"
                value={option.value}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PrepareRow({
  note,
  tone,
  children,
}: {
  note: string;
  /** "pending" marks the note as what still blocks saving. */
  tone?: "pending" | "ready";
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p
        aria-live="polite"
        className={cn(
          "text-xs text-muted-foreground",
          tone === "pending" &&
            "w-fit rounded-full bg-status-pending px-2.5 py-1 font-medium text-status-pending-foreground",
        )}
      >
        {note}
      </p>
      {children}
    </div>
  );
}
