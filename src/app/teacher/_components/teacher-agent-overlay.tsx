"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityAssistant,
  ActivityAssistantSessionProvider,
  type ActivityAssistantClassroom,
} from "./activity-assistant";
import { MessageSquareTextIcon, SparklesIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const panelId = "teacher-agent-panel";
const panelTitleId = "teacher-agent-panel-title";
const panelMotionMs = 240;

export function TeacherAgentOverlay({
  children,
  classrooms,
  startOpen = false,
}: Readonly<{
  children: ReactNode;
  classrooms: ActivityAssistantClassroom[];
  startOpen?: boolean;
}>) {
  const [open, setOpen] = useState(startOpen);
  const [rendered, setRendered] = useState(startOpen);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const openPanel = () => {
    setRendered(true);
    setOpen(true);
  };

  const closePanel = () => {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  };

  useEffect(() => {
    if (open || !rendered) {
      return;
    }

    const hide = window.setTimeout(() => setRendered(false), panelMotionMs);
    return () => window.clearTimeout(hide);
  }, [open, rendered]);

  useEffect(() => {
    if (!open) {
      return;
    }

    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setOpen(false);
        requestAnimationFrame(() => launcherRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <ActivityAssistantSessionProvider>
      {children}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        data-open={open}
      >
        {rendered ? (
          <aside
            className={cn(
              "pointer-events-auto absolute right-2 bottom-[4.375rem] grid h-[calc(100svh-5rem)] w-[calc(100vw-1rem)] origin-bottom-right grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border bg-background shadow-lg transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none min-[360px]:right-4 min-[360px]:bottom-[5.125rem] min-[360px]:h-[min(680px,calc(100svh-6rem))] min-[360px]:w-[calc(100vw-2rem)] md:right-6 md:bottom-[5.75rem] md:h-[min(780px,calc(100svh-6rem))] md:min-h-90 md:w-[min(520px,calc(100vw-2rem))]",
              open
                ? "scale-100 opacity-100 starting:scale-95 starting:opacity-0"
                : "pointer-events-none scale-95 opacity-0",
            )}
            id={panelId}
            data-open={open}
            aria-hidden={!open}
            aria-labelledby={panelTitleId}
            inert={!open}
          >
            <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
              <div className="space-y-0.5">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <SparklesIcon className="size-3.5" />
                  CDAS Agent · 试行
                </p>
                <h2 className="text-base font-semibold" id={panelTitleId}>
                  独立会话
                </h2>
                <p className="text-xs text-muted-foreground">教师工作台与活动设计</p>
              </div>
              <Button
                ref={closeRef}
                aria-label="关闭 CDAS Agent 会话"
                onClick={closePanel}
                size="icon"
                type="button"
                variant="ghost"
              >
                <XIcon />
              </Button>
            </header>
            <div className="grid min-h-0 overflow-hidden">
              <ActivityAssistant classrooms={classrooms} surface="panel" />
            </div>
          </aside>
        ) : null}

        <button
          ref={launcherRef}
          className="pointer-events-auto absolute right-2 bottom-2 grid size-13 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-150 hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-95 min-[360px]:right-4 min-[360px]:bottom-4 md:right-6 md:bottom-6 md:size-14"
          type="button"
          aria-label={open ? "收起 CDAS Agent" : "打开 CDAS Agent 独立会话"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? closePanel() : openPanel())}
        >
          {open ? (
            <XIcon className="size-6" />
          ) : (
            <MessageSquareTextIcon className="size-6" />
          )}
          <span className="absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-background bg-foreground px-1 text-[9px] leading-3.5 font-bold text-background">
            AI
          </span>
        </button>
      </div>
    </ActivityAssistantSessionProvider>
  );
}
