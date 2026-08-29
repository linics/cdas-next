"use client";

import { useState, type ReactNode } from "react";
import styles from "./feedback-workspace.module.css";

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
      className={styles.workspaceGrid}
      data-rail-open={open ? "true" : "false"}
    >
      {evidence}
      <aside className={styles.feedbackRail} aria-label="评阅">
        <button
          type="button"
          className={styles.railToggle}
          aria-expanded={open}
          aria-controls="feedback-rail-body"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "收起评阅" : "展开评阅"}
        </button>
        <div id="feedback-rail-body" className={styles.railBody}>
          {children}
        </div>
      </aside>
    </div>
  );
}
