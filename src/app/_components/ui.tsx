"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import styles from "./ui.module.css";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return <span className={styles.statusBadge} data-tone={tone}>{children}</span>;
}

export function InlineAlert({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "danger" | "success";
}) {
  return <div className={styles.alert} data-tone={tone} role={tone === "danger" ? "alert" : "status"}>{children}</div>;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return <section className={styles.emptyState}><h2>{title}</h2><p>{children}</p>{action ? <div>{action}</div> : null}</section>;
}

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
      onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }}
      ref={dialogRef}
    >
      <div className={styles.dialogContent}>
        <h2 id={titleId}>{title}</h2>
        <div id={detailId}>{detail}</div>
        <div className={styles.dialogActions}>
          <button className={styles.secondaryButton} disabled={pending} onClick={onCancel} type="button">{cancelLabel}</button>
          <button className={styles.primaryButton} data-tone={tone} disabled={pending || disabled} onClick={onConfirm} type="button">{pending ? "正在处理…" : confirmLabel}</button>
        </div>
      </div>
    </dialog>
  );
}
