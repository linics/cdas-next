import { z } from "zod";

export const MAX_SUBMISSION_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const formats = {
  "image/jpeg": { kind: "IMAGE", extensions: ["jpg", "jpeg"] },
  "image/png": { kind: "IMAGE", extensions: ["png"] },
  "image/webp": { kind: "IMAGE", extensions: ["webp"] },
  "application/pdf": { kind: "PDF", extensions: ["pdf"] },
  "application/msword": { kind: "WORD", extensions: ["doc"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "WORD",
    extensions: ["docx"],
  },
} as const;

export type AttachmentKind = (typeof formats)[keyof typeof formats]["kind"];
export type SupportedAttachmentMediaType = keyof typeof formats;

function normalizedFilename(value: string): string {
  return value.normalize("NFC").trim();
}

function hasSafeFilename(value: string): boolean {
  const characters = Array.from(value);
  return (
    characters.length >= 1 &&
    characters.length <= 255 &&
    !/[\u0000-\u001f\u007f/\\]/u.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

function extension(value: string): string {
  const index = value.lastIndexOf(".");
  return index > 0 && index < value.length - 1
    ? value.slice(index + 1).toLowerCase()
    : "";
}

export const attachmentReservationSchema = z
  .object({
    filename: z.string().transform(normalizedFilename),
    mediaType: z.string(),
    byteSize: z.int().positive().max(MAX_ATTACHMENT_BYTES),
  })
  .strict()
  .superRefine((value, context) => {
    if (!hasSafeFilename(value.filename)) {
      context.addIssue({
        code: "custom",
        message: "ATTACHMENT_FILENAME_INVALID",
        path: ["filename"],
      });
    }
    const format = formats[value.mediaType as SupportedAttachmentMediaType];
    if (!format) {
      context.addIssue({
        code: "custom",
        message: "ATTACHMENT_MEDIA_TYPE_UNSUPPORTED",
        path: ["mediaType"],
      });
      return;
    }
    if (!(format.extensions as readonly string[]).includes(extension(value.filename))) {
      context.addIssue({
        code: "custom",
        message: "ATTACHMENT_EXTENSION_MISMATCH",
        path: ["filename"],
      });
    }
  })
  .transform((value) => ({
    ...value,
    mediaType: value.mediaType as SupportedAttachmentMediaType,
    kind: formats[value.mediaType as SupportedAttachmentMediaType].kind,
  }));

export type AttachmentReservation = z.infer<typeof attachmentReservationSchema>;
