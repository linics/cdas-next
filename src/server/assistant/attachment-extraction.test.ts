import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  extractDocxText,
} from "./submission-attachment-reader";

/**
 * The reader's own tests substitute these parsers, which is right for testing
 * its branching but means Mammoth is never actually run by the suite. This
 * file runs Mammoth against a real file, offline and free, so a
 * dependency upgrade that breaks extraction fails here rather than in front
 * of a teacher.
 */
function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(__dirname, "__fixtures__", name)),
  );
}

function zipWithEntries(
  entries: readonly {
    name: string;
    uncompressedSize: number;
    data?: Uint8Array;
    method?: 0 | 8;
  }[],
): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data ?? new Uint8Array();
    const method = entry.method ?? 0;
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, 0, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, entry.uncompressedSize, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, 0, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, entry.uncompressedSize, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);

    localParts.push(local);
    centralParts.push(central);
    localOffset += local.byteLength;
  }

  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  const result = new Uint8Array(localOffset + centralSize + end.byteLength);
  let offset = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

describe("attachment text extraction", () => {
  it("pulls Chinese body text out of a DOCX", async () => {
    const text = await extractDocxText(fixture("proposal.docx"));

    expect(text).toContain("校园节水建议书");
    expect(text).toContain("25.6");
    expect(text).toContain("节水龙头");
  });

  it("rejects a DOCX ZIP entry whose declared expansion is too large", async () => {
    const bytes = zipWithEntries([
      { name: "word/document.xml", uncompressedSize: 8 * 1024 * 1024 + 1 },
    ]);

    await expect(extractDocxText(bytes)).rejects.toThrow(
      "DOCX_ARCHIVE_LIMIT_EXCEEDED",
    );
  });

  it("rejects a DOCX deflate entry that expands beyond its declaration", async () => {
    const expanded = new TextEncoder().encode("A".repeat(9 * 1024 * 1024));
    const bytes = zipWithEntries([
      {
        name: "word/document.xml",
        // The central directory lies about the output size. The local entry
        // contains a real deflate stream whose output exceeds the per-entry
        // budget, so the parser must stop before Mammoth sees it.
        uncompressedSize: 1,
        data: deflateRawSync(expanded),
        method: 8,
      },
    ]);

    await expect(extractDocxText(bytes)).rejects.toThrow(
      "DOCX_ARCHIVE_LIMIT_EXCEEDED",
    );
  });

  it("rejects a DOCX ZIP with too many central-directory entries", async () => {
    const entries = Array.from({ length: 513 }, (_, index) => ({
      name: `word/part-${index}.xml`,
      uncompressedSize: 0,
    }));

    await expect(extractDocxText(zipWithEntries(entries))).rejects.toThrow(
      "DOCX_ARCHIVE_LIMIT_EXCEEDED",
    );
  });
});
