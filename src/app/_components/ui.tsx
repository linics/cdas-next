import type { ReactNode } from "react";
import styles from "./ui.module.css";

export { ConfirmDialog } from "./confirm-dialog";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return (
    <span className={styles.statusBadge} data-tone={tone}>
      <span aria-hidden="true" className={styles.statusDot} />
      {children}
    </span>
  );
}

export function InlineAlert({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "danger" | "success";
}) {
  return (
    <div
      className={styles.alert}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      {children}
    </div>
  );
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
  return (
    <section className={styles.emptyState}>
      <p className={styles.emptyIndex} aria-hidden="true">—</p>
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
        {action ? <div>{action}</div> : null}
      </div>
    </section>
  );
}
