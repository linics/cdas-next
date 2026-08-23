import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localDateTimeToIsoInstant } from "./local-date-time-input";

const originalTimeZone = process.env.TZ;

describe.sequential("local deadline input", () => {
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });

  afterAll(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  it("converts a New York datetime-local value to its exact UTC instant", () => {
    expect(localDateTimeToIsoInstant("2026-08-31T23:59")).toBe(
      "2026-09-01T03:59:00.000Z",
    );
  });

  it("uses the native DST offset on both sides of the spring transition", () => {
    expect(localDateTimeToIsoInstant("2026-03-08T01:30")).toBe(
      "2026-03-08T06:30:00.000Z",
    );
    expect(localDateTimeToIsoInstant("2026-03-08T03:30")).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  it("locks the native earlier offset for a repeated fall-back time", () => {
    expect(localDateTimeToIsoInstant("2026-11-01T01:30")).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("rejects malformed, impossible, and DST-gap local values", () => {
    expect(localDateTimeToIsoInstant("not-a-date")).toBeNull();
    expect(localDateTimeToIsoInstant("2026-02-31T12:00")).toBeNull();
    expect(localDateTimeToIsoInstant("2026-03-08T02:30")).toBeNull();
    expect(localDateTimeToIsoInstant("")).toBe("");
  });
});
