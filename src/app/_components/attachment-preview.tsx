"use client";

import { useState } from "react";
import { DownloadIcon, EyeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { attachmentDisposition } from "../../domain/submission/attachment-policy";

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
  const inline = attachmentDisposition(attachment.mediaType) === "inline";

  if (!inline) {
    return null;
  }

  const isImage = attachment.mediaType.startsWith("image/");

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <EyeIcon />
          预览
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[85vh] max-w-[min(64rem,calc(100vw-2rem))] flex-col gap-4 sm:max-w-[min(64rem,calc(100vw-2rem))]">
        <DialogHeader className="pr-8">
          <DialogDescription>附件预览</DialogDescription>
          <DialogTitle className="truncate">{attachment.filename}</DialogTitle>
        </DialogHeader>
        {/* Only mounted while open: an iframe per attachment would otherwise
            fetch every file the moment the page renders. */}
        {open ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border bg-muted/40">
            {isImage ? (
              // next/image cannot serve this: the bytes come from a private,
              // no-store, per-actor authorised stream, so there is nothing for
              // an optimiser to cache or re-fetch on its own.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={attachment.filename}
                className="max-h-full max-w-full object-contain"
                src={downloadHref(attachment.id)}
              />
            ) : (
              <iframe
                className="size-full bg-background"
                src={downloadHref(attachment.id)}
                title={attachment.filename}
              />
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button asChild variant="outline">
            <a download={attachment.filename} href={downloadHref(attachment.id)}>
              <DownloadIcon />
              下载原件
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
