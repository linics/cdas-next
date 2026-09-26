"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

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
  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <p className="text-xs text-muted-foreground">请核对本次操作</p>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{detail}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          {/* 不用 AlertDialogAction：它点完就关，而这里要等服务端结果。 */}
          <Button
            disabled={pending || disabled}
            onClick={onConfirm}
            type="button"
            variant={tone === "danger" ? "destructive" : "default"}
          >
            {pending ? "正在处理…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
