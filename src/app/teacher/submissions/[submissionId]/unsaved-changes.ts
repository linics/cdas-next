"use client";

import { useEffect } from "react";

/**
 * Warn before leaving the page while a composer holds unsaved input (D-069).
 * Queue navigation uses plain anchors, so this also covers 上一份 / 下一份.
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Some browsers still require a returnValue to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
