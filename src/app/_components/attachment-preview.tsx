"use client";

import { useEffect, useId, useRef, useState } from "react";
import { attachmentDisposition } from "../../domain/submission/attachment-policy";
import styles from "./attachment-preview.module.css";

export type PreviewableAttachment = Readonly<{
  id: string;
  filename: string;
  mediaType: string;
}>;

function downloadHref(attachmentId: string): string {
  return `/attachments/${attachmentId}/download`;
}

/**
 * Preview is an overlay, and never replaces the download.
 *
 * Kept out of the evidence column on purpose: the review workspace must not be
 * stretched into one long band, so a full-size document opens over the page
 * instead of inside it. Word is not offered a preview at all — the browser
 * cannot render it, and a button that opens a download is a lie.
 */
export function AttachmentPreview({
  attachment,
}: {
  attachment: PreviewableAttachment;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const inline = attachmentDisposition(attachment.mediaType) === "inline";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!inline) {
    return null;
  }

  const isImage = attachment.mediaType.startsWith("image/");

  return (
    <>
      <button
        className={styles.previewButton}
        type="button"
        onClick={() => setOpen(true)}
      >
        预览
      </button>
      <dialog
        aria-labelledby={titleId}
        className={styles.previewDialog}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        ref={dialogRef}
      >
        <div className={styles.previewFrame}>
          <header className={styles.previewHeader}>
            <div>
              <p className={styles.previewKicker}>附件预览</p>
              <h2 id={titleId}>{attachment.filename}</h2>
            </div>
            <div className={styles.previewActions}>
              <a
                className={styles.previewDownload}
                href={downloadHref(attachment.id)}
                download={attachment.filename}
              >
                下载原件
              </a>
              <button type="button" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
          </header>
          {/* Only mounted while open: an iframe per attachment would otherwise
              fetch every file the moment the page renders. */}
          {open ? (
            <div className={styles.previewBody}>
              {isImage ? (
                // next/image cannot serve this: the bytes come from a private,
                // no-store, per-actor authorised stream, so there is nothing for
                // an optimiser to cache or re-fetch on its own.
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={attachment.filename} src={downloadHref(attachment.id)} />
              ) : (
                <iframe
                  src={downloadHref(attachment.id)}
                  title={attachment.filename}
                />
              )}
            </div>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
