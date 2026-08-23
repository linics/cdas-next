import { describe, expect, it } from "vitest";
import {
  hasMeaningfulTextEvidence,
  MAX_TEXT_EVIDENCE_CODE_POINTS,
  workingTextEvidenceSchema,
} from "./text-evidence";

describe("text evidence contract", () => {
  it.each([
    "",
    " \n\t",
    "\u00a0",
    "\u0085",
    "\u200b",
    "\u200d",
    "\ufe0f",
    "\u{e0100}",
  ])(
    "treats %j as visually empty",
    (value) => {
      expect(hasMeaningfulTextEvidence(value)).toBe(false);
    },
  );

  it("normalizes line endings and preserves meaningful Unicode", () => {
    const parsed = workingTextEvidenceSchema.parse("观察：水量下降。\r\n👍");
    expect(parsed).toBe("观察：水量下降。\n👍");
    expect(hasMeaningfulTextEvidence(parsed)).toBe(true);
  });

  it("limits text by Unicode code points rather than UTF-16 units", () => {
    expect(
      workingTextEvidenceSchema.safeParse(
        "👍".repeat(MAX_TEXT_EVIDENCE_CODE_POINTS),
      ).success,
    ).toBe(true);
    expect(
      workingTextEvidenceSchema.safeParse(
        "水".repeat(MAX_TEXT_EVIDENCE_CODE_POINTS + 1),
      ).success,
    ).toBe(false);
  });
});
