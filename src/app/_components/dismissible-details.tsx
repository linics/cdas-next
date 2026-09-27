"use client";

import { useEffect, useRef, type ComponentProps } from "react";

/**
 * A native <details> menu that also closes on an outside click or Escape.
 * The markup and forms inside still render and work without scripts.
 */
export function DismissibleDetails(props: ComponentProps<"details">) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        details.open = false;
        details.querySelector("summary")?.focus();
        return;
      }
      if (!details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return <details ref={ref} {...props} />;
}
