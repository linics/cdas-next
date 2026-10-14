"use client";

import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SparklesIcon, XIcon } from "lucide-react";
import type { ActivityContentV3 } from "../../../domain/activity/activity-content";
import {
  selectionRewritePresets,
  taskBookTextAt,
  type SelectionRewritePreset,
} from "../../../domain/activity/selection-rewrite";
import { suggestSelectionRewriteAction } from "./selection-rewrite-actions";

type Target = Readonly<{ path: string; start: number; end: number; fieldText: string }>;
type Action = SelectionRewritePreset | "custom";
type Phase =
  | Readonly<{ kind: "choosing" }>
  | Readonly<{ kind: "loading"; action: Action }>
  | Readonly<{ kind: "preview"; action: Action; replacement: string; note: string; fieldText: string }>
  | Readonly<{ kind: "error"; message: string }>;

const presetLabels: Readonly<Record<SelectionRewritePreset, string>> = {
  specific: "写具体",
  student: "换成学生的话",
  shorter: "精简",
  realistic: "更贴近真实情境",
};

/** Shorter selections are usually a stray click, not a request. */
const minimumSelection = 2;

function rewriteField(container: HTMLElement, path: string) {
  return container.querySelector<HTMLTextAreaElement | HTMLInputElement>(
    `[data-rewrite-path="${CSS.escape(path)}"]`,
  );
}

/**
 * D-098: select words in a task-book field, ask for a rewrite of just those
 * words, and decide next to the original whether it goes in. The editor is
 * the only thing that changes; saving stays the teacher's own step.
 */
export function SelectionRewriteBar({
  containerRef,
  taskBook,
  onApply,
}: Readonly<{
  containerRef: RefObject<HTMLElement | null>;
  taskBook: ActivityContentV3;
  onApply: (path: string, text: string) => void;
}>) {
  const [target, setTarget] = useState<Target | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "choosing" });
  const [instruction, setInstruction] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const busy = phase.kind === "loading" || phase.kind === "preview";

  // Follow the teacher's selection in any field marked as rewritable.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const read = (event: Event) => {
      if (busy || (event.target instanceof Node && barRef.current?.contains(event.target))) return;
      const field = document.activeElement;
      if (
        !(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) ||
        !container.contains(field) ||
        !field.dataset.rewritePath ||
        field.disabled
      ) {
        return;
      }
      const start = field.selectionStart ?? 0;
      const end = field.selectionEnd ?? 0;
      if (end - start < minimumSelection || !field.value.slice(start, end).trim()) {
        setTarget(null);
        return;
      }
      setTarget({ path: field.dataset.rewritePath, start, end, fieldText: field.value });
      setPhase({ kind: "choosing" });
    };
    container.addEventListener("mouseup", read);
    container.addEventListener("keyup", read);
    container.addEventListener("select", read, true);
    return () => {
      container.removeEventListener("mouseup", read);
      container.removeEventListener("keyup", read);
      container.removeEventListener("select", read, true);
    };
  }, [containerRef, busy]);

  // Sit just under the field, or above it near the bottom of the window.
  useEffect(() => {
    const container = containerRef.current;
    if (!target || !container) return;
    const place = () => {
      const field = rewriteField(container, target.path);
      if (!field) return setPosition(null);
      const rect = field.getBoundingClientRect();
      const height = barRef.current?.offsetHeight ?? 160;
      const below = rect.bottom + 8;
      const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 8) : below;
      const width = Math.min(360, window.innerWidth - 16);
      setPosition({ top, left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8) });
    };
    // After this render, so the bar's own height is known. A timer rather
    // than a frame: a background tab never runs animation frames.
    const timer = window.setTimeout(place, 0);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [containerRef, target, phase.kind]);

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    setTarget(null);
    setPhase({ kind: "choosing" });
    setInstruction("");
  }

  async function request(action: Action) {
    if (!target) return;
    setPhase({ kind: "loading", action });
    const result = await suggestSelectionRewriteAction({
      fieldPath: target.path,
      fieldText: target.fieldText,
      selectionStart: target.start,
      selectionEnd: target.end,
      action,
      instruction: action === "custom" ? instruction : "",
      taskBook,
    });
    setPhase(
      result.status === "ok"
        ? { kind: "preview", action, replacement: result.replacement, note: result.note, fieldText: result.fieldText }
        : { kind: "error", message: result.message },
    );
  }

  function apply() {
    const container = containerRef.current;
    if (!target || phase.kind !== "preview" || !container) return;
    // The teacher may have kept typing while the suggestion was written.
    if (taskBookTextAt(taskBook, target.path) !== target.fieldText) {
      setPhase({ kind: "error", message: "这段文字在等待期间改动过，请重新选中后再试。" });
      return;
    }
    onApply(target.path, phase.fieldText);
    const end = target.start + phase.replacement.length;
    const field = rewriteField(container, target.path);
    close();
    window.setTimeout(() => {
      field?.focus();
      field?.setSelectionRange(target.start, end);
    }, 0);
  }

  if (!target || !position) return null;
  const selected = target.fieldText.slice(target.start, target.end);
  // Keep the field's own selection while the bar's buttons are pressed.
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  // On the body: the editor sits inside an animated (transformed) layout,
  // which would make a fixed bar position against it instead of the window.
  return createPortal(
    <div
      ref={barRef}
      role="dialog"
      aria-label="改写选中的文字"
      className="fixed z-50 flex w-[min(360px,calc(100vw-16px))] flex-col gap-2 rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg backdrop-blur-2xl"
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <SparklesIcon aria-hidden="true" className="size-3.5" />
          改写选中的 {Array.from(selected).length} 个字
        </p>
        <button type="button" aria-label="关闭" className="text-muted-foreground hover:text-foreground" onMouseDown={keepFocus} onClick={close}>
          <XIcon className="size-4" />
        </button>
      </div>

      {phase.kind === "choosing" || phase.kind === "error" ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(selectionRewritePresets) as SelectionRewritePreset[]).map((key) => (
              <button
                key={key}
                type="button"
                className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent"
                onMouseDown={keepFocus}
                onClick={() => void request(key)}
              >
                {presetLabels[key]}
              </button>
            ))}
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (instruction.trim()) void request("custom");
            }}
          >
            <input
              aria-label="自己写改写要求"
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs"
              placeholder="或写下要求，比如「加一个测量步骤」"
              maxLength={200}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
            <button type="submit" className="rounded-md border px-2 py-1 text-xs hover:bg-accent" disabled={!instruction.trim()}>
              改写
            </button>
          </form>
          {phase.kind === "error" ? (
            <p role="alert" className="text-xs text-destructive">{phase.message}</p>
          ) : null}
        </>
      ) : null}

      {phase.kind === "loading" ? (
        <p role="status" className="text-xs text-muted-foreground">正在改写这段文字…</p>
      ) : null}

      {phase.kind === "preview" ? (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-xs leading-relaxed">
            <span className="text-muted-foreground">原文：</span>
            <del className="rounded-sm bg-destructive/10 text-destructive">{selected}</del>
          </p>
          <p className="text-xs leading-relaxed">
            <span className="text-muted-foreground">建议：</span>
            <ins className="rounded-sm bg-primary/15 font-medium no-underline">{phase.replacement}</ins>
          </p>
          {phase.note ? <p className="text-xs text-muted-foreground">{phase.note}</p> : null}
          <div className="flex gap-1.5">
            <button type="button" className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground" onMouseDown={keepFocus} onClick={apply}>
              替换
            </button>
            <button type="button" className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent" onMouseDown={keepFocus} onClick={() => void request(phase.action)}>
              再来一次
            </button>
            <button type="button" className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground" onMouseDown={keepFocus} onClick={close}>
              不用了
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">替换后只改编辑器里的文字，照常自动保存，保存为版本仍由你来点。</p>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
