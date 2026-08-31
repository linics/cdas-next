import { describe, expect, it } from "vitest";
import {
  generateSchoolCode,
  hashTeacherInvite,
  normalizeSchoolCode,
  normalizeStaffNo,
  pendingTeacherAuthSubject,
  schoolCodeSchema,
  staffNoSchema,
} from "./identity";
import { legacySchoolCode } from "./legacy-school";

describe("school identity helpers", () => {
  it("normalizes school codes to the public generator alphabet", () => {
    expect(normalizeSchoolCode(" ｓｃｈ-7k 9m2 ")).toBe("SCH7K9M2");
    expect(schoolCodeSchema.parse("scharchx")).toBe(legacySchoolCode);
    expect(generateSchoolCode()).toMatch(/^SCH[A-HJ-NP-Z2-9]{5}$/u);
  });

  it("normalizes staff numbers and hashes invite codes", () => {
    expect(normalizeStaffNo(" t-01 ")).toBe("T-01");
    expect(staffNoSchema.parse("t-01")).toBe("T-01");
    expect(hashTeacherInvite("secret")).toHaveLength(64);
    expect(pendingTeacherAuthSubject("abc")).toBe("pending:abc");
  });
});
