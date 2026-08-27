"use client";

import { useId, useRef, type ReactNode } from "react";
import styles from "./submission-workspace.module.css";

export function TaskBookDialog({
  children,
}: {
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button
        className={styles.secondaryButton}
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        查看完整任务书
      </button>
      <dialog
        aria-labelledby={titleId}
        className={styles.taskBookDialog}
        ref={dialogRef}
      >
        <div className={styles.taskBookDialogContent}>
          <header className={styles.taskBookDialogHeader}>
            <h2 id={titleId}>完整任务书</h2>
            <button
              className={styles.secondaryButton}
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              关闭
            </button>
          </header>
          {children}
        </div>
      </dialog>
    </>
  );
}
