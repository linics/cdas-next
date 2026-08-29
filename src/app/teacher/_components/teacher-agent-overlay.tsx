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
import styles from "./teacher-agent-overlay.module.css";

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
      <div className={styles.overlay} data-open={open}>
        {rendered ? (
          <aside
            className={styles.panel}
            id={panelId}
            data-open={open}
            aria-hidden={!open}
            aria-labelledby={panelTitleId}
            inert={!open}
          >
            <header className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>CDAS Agent · 试行</p>
                <h2 id={panelTitleId}>独立会话</h2>
                <p className={styles.duty}>教师工作台与活动设计</p>
              </div>
              <button
                ref={closeRef}
                className={styles.closeButton}
                type="button"
                aria-label="关闭 CDAS Agent 会话"
                onClick={closePanel}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>
            <div className={styles.panelBody}>
              <ActivityAssistant classrooms={classrooms} surface="panel" />
            </div>
          </aside>
        ) : null}

        <button
          ref={launcherRef}
          className={styles.launcher}
          type="button"
          aria-label={open ? "收起 CDAS Agent" : "打开 CDAS Agent 独立会话"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? closePanel() : openPanel())}
        >
          <svg aria-hidden="true" viewBox="0 0 32 32">
            <path d="M9 8.5h14a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4h-7l-5.5 3v-3H9a4 4 0 0 1-4-4v-7a4 4 0 0 1 4-4Z" />
            <path d="M11 15.8h10M11 19.2h6" />
            <path className={styles.spark} d="M23.5 4v3M22 5.5h3" />
          </svg>
          <span>AI</span>
        </button>
      </div>
    </ActivityAssistantSessionProvider>
  );
}
