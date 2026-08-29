import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  extractDocxText,
  extractPdfText,
} from "./submission-attachment-reader";

/**
 * The reader's own tests substitute these parsers, which is right for testing
 * its branching but means pdfjs-dist and mammoth are never actually run by the
 * suite. This file runs them against real files, offline and free, so a
 * dependency upgrade that breaks extraction fails here rather than in front of
 * a teacher.
 */
function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(__dirname, "__fixtures__", name)),
  );
}

describe("attachment text extraction", () => {
  it("pulls the readable numbers out of a text PDF", async () => {
    const text = await extractPdfText(fixture("water-survey.pdf"));

    expect(text).toContain("6.7");
    expect(text).toContain("25.6");
    expect(text).toContain("11.3");
    expect(text).toContain("canteen uses the most water");
  });

  it("returns nothing for a PDF that is only a scanned image", async () => {
    // The reader turns this into an explicit "probably a scan, no OCR this
    // round" note. It must stay empty rather than become plausible-looking
    // text, or a teacher gets a draft written from nothing.
    const text = await extractPdfText(fixture("scanned-only.pdf"));

    expect(text.trim()).toBe("");
  });

  it("pulls Chinese body text out of a DOCX", async () => {
    const text = await extractDocxText(fixture("proposal.docx"));

    expect(text).toContain("校园节水建议书");
    expect(text).toContain("25.6");
    expect(text).toContain("节水龙头");
  });

  it("fails rather than inventing text for bytes that are not a document", async () => {
    await expect(extractPdfText(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
