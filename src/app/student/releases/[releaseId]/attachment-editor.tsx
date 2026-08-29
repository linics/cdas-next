"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_SUBMISSION_ATTACHMENTS,
} from "../../../../domain/submission/attachment-policy";
import type { AttachmentUploadStrategy } from "../../../../server/attachments/attachment-storage-factory";
import type { StudentReleaseWorkspace } from "../../../../server/queries/submission-workspace";
import {
  finalizeAttachmentUploadAction,
  refreshAttachmentScanAction,
  removeAttachmentAction,
  reserveAttachmentUploadAction,
} from "./attachment-actions";
import { AttachmentPreview } from "../../../_components/attachment-preview";
import styles from "./submission-workspace.module.css";

/**
 * Two backends, two ways in. Vercel Blob hands out a presigned token and the
 * browser writes straight to it; a self-hosted disk has nothing to presign, so
 * the bytes go through the app. The Blob client is imported only on the branch
 * that uses it, so a deployment without Blob never loads it.
 */
async function putBytes(
  strategy: AttachmentUploadStrategy | null,
  reserved: Readonly<{ pathname: string; attachmentId: string }>,
  file: File,
): Promise<void> {
  if (strategy === "server-received") {
    const body = new FormData();
    body.set("attachmentId", reserved.attachmentId);
    body.set("file", file);
    const response = await fetch("/attachments/receive", {
      method: "POST",
      body,
    });
    if (!response.ok) {
      throw new Error(`${file.name} 上传失败。`);
    }
    return;
  }
  const { uploadPresigned } = await import("@vercel/blob/client");
  await uploadPresigned(reserved.pathname, file, {
    access: "private",
    contentType: inferredMediaType(file),
    handleUploadUrl: "/attachments/upload",
    clientPayload: reserved.attachmentId,
  });
}

type WorkingCopy = NonNullable<
  NonNullable<StudentReleaseWorkspace["submission"]>["workingCopy"]
>;

const acceptedMediaTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

function inferredMediaType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      pdf: "application/pdf",
      doc: "application/msword",
      docx:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }[extension ?? ""] ?? ""
  );
}

function formattedBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

const statusCopy = {
  UPLOAD_PENDING: "等待上传",
  SCAN_PENDING: "内容验证中",
  READY: "可正式提交",
  REJECTED: "内容验证未通过",
} as const;

const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

export function AttachmentEditor({
  releaseId,
  workingCopy,
  upload: uploadStrategy,
  canWrite,
}: Readonly<{
  releaseId: string;
  workingCopy: WorkingCopy;
  upload: AttachmentUploadStrategy | null;
  canWrite: boolean;
}>) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    hydratedSnapshot,
    serverSnapshot,
  );
  const attachments = workingCopy.attachments;

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const selected = Array.from(files).slice(
      0,
      MAX_SUBMISSION_ATTACHMENTS - attachments.length,
    );
    setBusy(true);
    setMessage(null);
    let version = workingCopy.version;
    try {
      for (const file of selected) {
        if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`${file.name} 必须小于等于 20 MB。`);
        }
        const reserved = await reserveAttachmentUploadAction({
          releaseId,
          workingCopyId: workingCopy.id,
          workingVersion: version,
          filename: file.name,
          mediaType: inferredMediaType(file),
          byteSize: file.size,
          idempotencyKey: `attachment_${crypto.randomUUID()}`,
        });
        if (!reserved.ok || !reserved.pathname || !reserved.workingVersion) {
          throw new Error(reserved.ok ? "无法创建附件上传。" : reserved.message);
        }
        version = reserved.workingVersion;
        await putBytes(uploadStrategy, { pathname: reserved.pathname, attachmentId: reserved.attachmentId }, file);
        const finalized = await finalizeAttachmentUploadAction({
          releaseId,
          attachmentId: reserved.attachmentId,
        });
        if (!finalized.ok) {
          throw new Error(finalized.message);
        }
        const verified = await refreshAttachmentScanAction({
          releaseId,
          attachmentId: reserved.attachmentId,
        });
        if (!verified.ok) {
          throw new Error(verified.message);
        }
        if (verified.status === "REJECTED") {
          throw new Error(`${file.name} 的内容与声明格式不一致，请移除后重新选择文件。`);
        }
      }
      setMessage("文件已上传并完成内容验证，可正式提交。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "附件上传失败。");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    }
  }

  async function refresh(attachmentId: string) {
    setBusy(true);
    const result = await refreshAttachmentScanAction({
      releaseId,
      attachmentId,
    });
    setMessage(
      result.ok
        ? result.status === "READY"
          ? "内容验证已通过。"
          : result.status === "REJECTED"
            ? "文件内容与声明格式不一致，请移除后改用其他文件。"
            : "内容验证仍在进行。"
        : result.message,
    );
    setBusy(false);
    router.refresh();
  }

  async function remove(attachmentId: string) {
    setBusy(true);
    const result = await removeAttachmentAction({
      releaseId,
      attachmentId,
      workingCopyId: workingCopy.id,
      workingVersion: workingCopy.version,
      idempotencyKey: `remove_attachment_${crypto.randomUUID()}`,
    });
    setMessage(result.ok ? "附件已从工作草稿移除。" : result.message);
    setBusy(false);
    router.refresh();
  }

  return (
    <section
      className={styles.attachmentEditor}
      aria-labelledby="attachment-title"
      data-attachment-editor=""
      data-hydrated={hydrated ? "true" : "false"}
    >
      <div className={styles.attachmentHeading}>
        <div>
          <p className={styles.eyebrow}>附件证据</p>
          <h3 id="attachment-title">图片、PDF 或 Word</h3>
        </div>
        <span>{attachments.length} / {MAX_SUBMISSION_ATTACHMENTS}</span>
      </div>

      {attachments.length > 0 ? (
        <ul className={styles.attachmentList}>
          {attachments.map((attachment) => (
            <li key={attachment.id} data-status={attachment.status}>
              <div>
                <strong>{attachment.filename}</strong>
                <span>{formattedBytes(attachment.byteSize)} · {statusCopy[attachment.status]}</span>
              </div>
              <div className={styles.attachmentActions}>
                {attachment.status === "READY" ? (
                  <>
                    <AttachmentPreview attachment={attachment} />
                    <a href={`/attachments/${attachment.id}/download`}>下载</a>
                  </>
                ) : attachment.status === "SCAN_PENDING" && canWrite ? (
                  <button type="button" disabled={busy} onClick={() => refresh(attachment.id)}>
                    刷新检查
                  </button>
                ) : null}
                {canWrite ? (
                  <button type="button" disabled={busy} onClick={() => remove(attachment.id)}>
                    移除
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.attachmentEmpty}>当前工作草稿还没有附件。</p>
      )}

      {canWrite && uploadStrategy && attachments.length < MAX_SUBMISSION_ATTACHMENTS ? (
        <label className={styles.attachmentPicker}>
          <span>{busy ? "正在处理…" : "选择附件"}</span>
          <input
            ref={inputRef}
            type="file"
            accept={acceptedMediaTypes}
            multiple
            disabled={busy || !hydrated}
            onChange={(event) => upload(event.target.files)}
          />
        </label>
      ) : canWrite && !uploadStrategy ? (
        <p className={styles.attachmentEmpty}>附件存储尚未启用，文字提交不受影响。</p>
      ) : null}
      <p className={styles.attachmentHelp}>单文件最大 20 MB；未通过内容验证的文件不能进入正式修订。</p>
      {message ? <p className={styles.attachmentMessage} role="status">{message}</p> : null}
    </section>
  );
}
