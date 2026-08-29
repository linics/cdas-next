import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentDisposition,
  attachmentReservationSchema,
} from "./attachment-policy";

describe("attachment reservation policy", () => {
  it.each([
    ["观察.jpg", "image/jpeg", "IMAGE"],
    ["report.PDF", "application/pdf", "PDF"],
    [
      "learning-evidence.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "WORD",
    ],
  ])("accepts %s with matching media type", (filename, mediaType, kind) => {
    expect(
      attachmentReservationSchema.parse({ filename, mediaType, byteSize: 1024 }),
    ).toMatchObject({ filename, mediaType, byteSize: 1024, kind });
  });

  it("normalizes the display filename to NFC", () => {
    expect(
      attachmentReservationSchema.parse({
        filename: "  re\u0301sume\u0301.pdf  ",
        mediaType: "application/pdf",
        byteSize: 1,
      }).filename,
    ).toBe("résumé.pdf");
  });

  it.each([
    ["archive.zip", "application/zip", 1024],
    ["renamed.pdf", "image/png", 1024],
    ["../report.pdf", "application/pdf", 1024],
    ["empty.pdf", "application/pdf", 0],
    ["large.pdf", "application/pdf", MAX_ATTACHMENT_BYTES + 1],
  ])("rejects unsafe attachment %s", (filename, mediaType, byteSize) => {
    expect(
      attachmentReservationSchema.safeParse({ filename, mediaType, byteSize }).success,
    ).toBe(false);
  });
});

describe("attachmentDisposition", () => {
  it.each([
    ["image/jpeg"],
    ["image/png"],
    ["image/webp"],
    ["application/pdf"],
  ])("renders %s in place, because a browser can", (mediaType) => {
    expect(attachmentDisposition(mediaType)).toBe("inline");
  });

  it.each([
    ["application/msword"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ])("hands %s over as a download, because a browser cannot render it", (mediaType) => {
    expect(attachmentDisposition(mediaType)).toBe("attachment");
  });

  it.each([
    // Never rendered in our origin even though a browser would happily run them.
    ["text/html"],
    ["image/svg+xml"],
    ["application/javascript"],
    // A format that reached storage before it reached this table.
    ["image/gif"],
    [""],
  ])("refuses to render %s in place", (mediaType) => {
    expect(attachmentDisposition(mediaType)).toBe("attachment");
  });
});
