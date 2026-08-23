import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  formatDateTimeInstant,
  LocalizedDateTime,
} from "./localized-date-time";

const instant = "2026-08-18T12:00:00.000Z";

describe("localized date time", () => {
  it("formats the same instant differently in Taipei and New York", () => {
    const taipei = formatDateTimeInstant(instant, {
      locales: "zh-CN",
      timeZone: "Asia/Taipei",
    });
    const newYork = formatDateTimeInstant(instant, {
      locales: "zh-CN",
      timeZone: "America/New_York",
    });

    expect(taipei).toContain("20:00");
    expect(newYork).toContain("08:00");
    expect(taipei).toMatch(/GMT|台北/u);
    expect(newYork).toMatch(/GMT|EDT|EST|纽约/u);
    expect(taipei).not.toBe(newYork);
  });

  it("uses the New York DST offset before and after the spring transition", () => {
    const before = formatDateTimeInstant("2026-03-08T06:30:00.000Z", {
      locales: "zh-CN",
      timeZone: "America/New_York",
    });
    const after = formatDateTimeInstant("2026-03-08T07:30:00.000Z", {
      locales: "zh-CN",
      timeZone: "America/New_York",
    });

    expect(before).toContain("01:30");
    expect(after).toContain("03:30");
    expect(after).not.toContain("02:30");
  });

  it("rejects values that are not explicit valid instants", () => {
    expect(() => formatDateTimeInstant("not-a-date")).toThrow(RangeError);
    expect(() => formatDateTimeInstant("2026-08-18T12:00")).toThrow(
      RangeError,
    );
    expect(() =>
      formatDateTimeInstant("2026-02-31T12:00:00.000Z"),
    ).toThrow(RangeError);
  });

  it("server-renders semantic time markup without logging a React error", () => {
    const consoleError = vi.spyOn(console, "error");
    try {
      const markup = renderToStaticMarkup(
        <LocalizedDateTime dateTime={instant} />,
      );

      expect(markup).toContain(`<time`);
      expect(markup).toContain(`dateTime="${instant}"`);
      expect(markup).toContain("UTC");
      expect(markup).not.toContain("<script");
      expect(markup).not.toContain("dangerouslySetInnerHTML");
      expect(markup).not.toContain("台北");
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
