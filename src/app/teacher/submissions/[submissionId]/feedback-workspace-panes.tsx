"use client";

import { useState, type ReactNode } from "react";
import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 左边学生证据、右边评阅栏；两栏各自滚动。评阅栏可以收起，
 * 把整屏让给证据阅读。窄屏时两栏上下排、整页滚动。
 */
export function FeedbackWorkspacePanes({
  evidence,
  children,
}: {
  evidence: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 grid-cols-1 lg:overflow-hidden",
        open ? "lg:grid-cols-[minmax(0,1fr)_minmax(420px,36%)]" : "lg:grid-cols-[minmax(0,1fr)_auto]",
      )}
      data-rail-open={open ? "true" : "false"}
    >
      <div className="min-h-0 p-4 md:p-6 lg:overflow-y-auto">{evidence}</div>
      <aside
        aria-label="评阅"
        className="flex min-h-0 flex-col border-t bg-muted/30 lg:border-t-0 lg:border-l"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <span className={cn("text-sm font-medium", !open && "lg:sr-only")}>
            评阅
          </span>
          <Button
            aria-controls="feedback-rail-body"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {open ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
            {open ? "收起评阅" : "展开评阅"}
          </Button>
        </div>
        <div
          className={cn(
            "flex min-h-0 flex-col gap-4 p-4 lg:overflow-y-auto",
            !open && "hidden",
          )}
          id="feedback-rail-body"
        >
          {children}
        </div>
      </aside>
    </div>
  );
}
