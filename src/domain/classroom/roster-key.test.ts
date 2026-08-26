import { describe, expect, it } from "vitest";
import {
  normalizeRosterKey,
  parseRosterKeyList,
  rosterKeySchema,
} from "./roster-key";

describe("student roster keys", () => {
  it("normalizes operator and teacher input to one stored representation", () => {
    expect(normalizeRosterKey(" student-8a01 ")).toBe("STUDENT8A01");
    expect(rosterKeySchema.parse("ＳＴＵＤＥＮＴ８Ａ０１")).toBe("STUDENT8A01");
  });

  it("parses batches and reports duplicates without duplicating changes", () => {
    expect(parseRosterKeyList("student-8a01, STUDENT8A02\nstudent8a01")).toEqual({
      keys: ["STUDENT8A01", "STUDENT8A02"],
      duplicates: ["STUDENT8A01"],
    });
  });

  it("rejects invalid and oversized batches", () => {
    expect(() => rosterKeySchema.parse("short")).toThrow();
    expect(() => parseRosterKeyList("")).toThrow("ROSTER_KEY_COUNT_INVALID");
    expect(() => parseRosterKeyList(Array.from({ length: 51 }, (_, index) => `STUDENT${String(index).padStart(4, "0")}`).join("\n"))).toThrow("ROSTER_KEY_COUNT_INVALID");
  });
});
