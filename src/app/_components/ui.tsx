import type { ReactNode } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InboxIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export { ConfirmDialog } from "./confirm-dialog";

/**
 * 业务状态 → 四档状态色。颜色只来自 globals.css 的 --status-* token；
 * 状态文字必须写在徽章里，颜色只做辅助。
 */
export type StatusTone =
  | "pending"
  | "resubmit"
  | "done"
  | "closed"
  | "neutral";

const statusToneClass: Record<StatusTone, string> = {
  pending: "border-transparent bg-status-pending text-status-pending-foreground",
  resubmit:
    "border-transparent bg-status-resubmit text-status-resubmit-foreground",
  done: "border-transparent bg-status-done text-status-done-foreground",
  closed: "border-transparent bg-status-closed text-status-closed-foreground",
  neutral: "",
};

/** 旧的五档 tone 名，保留给还没迁移的调用方。 */
const legacyTone = {
  neutral: "neutral",
  info: "neutral",
  success: "done",
  warning: "resubmit",
  danger: "pending",
} as const satisfies Record<string, StatusTone>;

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: StatusTone | keyof typeof legacyTone;
  className?: string;
}) {
  const resolved: StatusTone =
    tone in legacyTone
      ? legacyTone[tone as keyof typeof legacyTone]
      : (tone as StatusTone);
  return (
    <Badge
      className={cn(statusToneClass[resolved], className)}
      variant={resolved === "neutral" ? "outline" : "default"}
    >
      {children}
    </Badge>
  );
}

const alertIcon = {
  info: InfoIcon,
  warning: TriangleAlertIcon,
  danger: CircleAlertIcon,
  success: CircleCheckIcon,
} as const;

export function InlineAlert({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "danger" | "success";
}) {
  const Icon = alertIcon[tone];
  return (
    <Alert
      role={tone === "danger" ? "alert" : "status"}
      variant={tone === "danger" ? "destructive" : "default"}
    >
      <Icon />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
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
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
