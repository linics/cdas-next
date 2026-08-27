"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import styles from "./ui.module.css";

export function ConfirmDialog({
  open,
  title,
  detail,
  cancelLabel = "取消",
  confirmLabel,
  tone = "primary",
  pending = false,
  disabled = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  detail: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  pending?: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const detailId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={detailId}
      aria-labelledby={titleId}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      ref={dialogRef}
    >
      <div className={styles.dialogContent}>
        <p className={styles.dialogKicker}>请核对本次操作</p>
        <h2 id={titleId}>{title}</h2>
        <div id={detailId}>{detail}</div>
        <div className={styles.dialogActions}>
          <button
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className={styles.primaryButton}
            data-tone={tone}
            disabled={pending || disabled}
            onClick={onConfirm}
            type="button"
          >
            {pending ? "正在处理…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
