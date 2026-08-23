import { describe, expect, it } from "vitest";
import {
  createSourceFingerprint,
  fingerprintFiles,
  sourceFingerprintFromEntries,
} from "./source-fingerprint";

describe("source fingerprint", () => {
  it("changes for path or bytes and fingerprints the current checkout", () => {
    const first = sourceFingerprintFromEntries([{ path: "src/a.ts", bytes: Buffer.from("a") }]);
    expect(sourceFingerprintFromEntries([{ path: "src/a.ts", bytes: Buffer.from("b") }])).not.toBe(first);
    expect(sourceFingerprintFromEntries([{ path: "src/b.ts", bytes: Buffer.from("a") }])).not.toBe(first);
    expect(sourceFingerprintFromEntries([{ path: "src/app/globals.css", bytes: Buffer.from("a") }])).not.toBe(first);
    expect(sourceFingerprintFromEntries([{ path: "src/app/globals.css", bytes: Buffer.from("b") }])).not.toBe(
      sourceFingerprintFromEntries([{ path: "src/app/globals.css", bytes: Buffer.from("a") }]),
    );
    expect(fingerprintFiles()).toEqual(
      expect.arrayContaining(["src/app/globals.css", "src/app/icon.svg"]),
    );
    expect(
      sourceFingerprintFromEntries([
        { path: "a", bytes: Buffer.from("xb\0c") },
      ]),
    ).not.toBe(
      sourceFingerprintFromEntries([
        { path: "a", bytes: Buffer.from("x") },
        { path: "b", bytes: Buffer.from("c") },
      ]),
    );
    expect(createSourceFingerprint()).toMatch(/^[a-f0-9]{64}$/u);
  });
});
