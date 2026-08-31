import { describe, expect, it } from "vitest";
import {
  deriveTeacherUsername,
  generateSchoolCode,
  generateTemporaryPassword,
  generateTeacherInvite,
  hashTeacherInvite,
  normalizeSchoolCode,
  normalizeStaffNo,
  schoolCodeSchema,
  staffNoSchema,
} from "./identity";

describe("school identity", () => {
  it("normalizes public school codes and staff numbers into their stored forms", () => {
    expect(normalizeSchoolCode(" ｓｃｈ-7k 9m2 ")).toBe("SCH7K9M2");
    expect(normalizeStaffNo(" t- 001 ")).toBe("T-001");
    expect(schoolCodeSchema.parse("sch-7k9m2")).toBe("SCH7K9M2");
    expect(staffNoSchema.parse(" t-001 ")).toBe("T-001");
  });

  it("rejects identifiers that cannot be used as a school or staff number", () => {
    expect(() => schoolCodeSchema.parse("SCH1")).toThrow();
    expect(() => schoolCodeSchema.parse("SCH0O1I2")).toThrow();
    expect(() => staffNoSchema.parse("teacher/01")).toThrow();
    expect(() => staffNoSchema.parse(" ")).toThrow();
  });

  it("hashes an invitation without preserving its plaintext", () => {
    expect(hashTeacherInvite("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("derives the same opaque Clerk username from normalized immutable identifiers", () => {
    expect(deriveTeacherUsername("sch-7k9m2", "t-001")).toBe(
      "t_b78f4b03d890dadb80159b1a03e07ed4f9b14c19",
    );
    expect(deriveTeacherUsername("SCH7K9M2", "T-001")).toBe(
      "t_b78f4b03d890dadb80159b1a03e07ed4f9b14c19",
    );
  });

  it("creates high-entropy invite, school code, and temporary password values with unambiguous alphabets", () => {
    expect(generateTeacherInvite()).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(generateSchoolCode()).toMatch(/^SCH[A-HJ-NP-Z2-9]{5}$/u);
    expect(generateTemporaryPassword()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{10}$/u);
  });
});
