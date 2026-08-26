import { describe, expect, it } from "vitest";

import {
  vercelAutomationBypassHeaders,
  vercelAutomationBypassSecretName,
  isAllowedVercelPreviewBaseUrl,
  stagingHealthRequestHeaders,
} from "./preview-protection";

describe("Vercel Deployment Protection automation bypass headers", () => {
  it("is optional for generic public staging requests", () => {
    expect(vercelAutomationBypassHeaders({})).toEqual({});
  });

  it("accepts exactly one valid bypass header", () => {
    const secret = "A".repeat(32);
    expect(vercelAutomationBypassHeaders({
      [vercelAutomationBypassSecretName]: secret,
    })).toEqual({ "x-vercel-protection-bypass": secret });
  });

  it.each(["short", "a".repeat(31), "a".repeat(33), "a".repeat(31) + "_", " a".repeat(16)])(
    "fails closed for malformed nonempty secrets", (secret) => {
      expect(() => vercelAutomationBypassHeaders({
        [vercelAutomationBypassSecretName]: secret,
      })).toThrow("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET_INVALID");
    },
  );
});

describe("staging health access mode headers", () => {
  it("keeps generic public staging independent of bypass configuration", () => {
    expect(stagingHealthRequestHeaders(false, {
      [vercelAutomationBypassSecretName]: "malformed",
    }, "challenge")).toEqual({
      accept: "application/json",
      "x-cdas-health-challenge": "challenge",
    });
  });

  it("adds bypass only in explicitly protected mode", () => {
    expect(stagingHealthRequestHeaders(true, {
      [vercelAutomationBypassSecretName]: "A".repeat(32),
    }, "challenge")).toEqual({
      accept: "application/json",
      "x-cdas-health-challenge": "challenge",
      "x-vercel-protection-bypass": "A".repeat(32),
    });
  });
});

describe("Vercel protected Preview origin", () => {
  it("accepts only an exact root Vercel preview for the configured project", () => {
    expect(isAllowedVercelPreviewBaseUrl(
      "https://cdas-next-preview123-linics1.vercel.app",
      "cdas-next",
    )).toBe(true);
    expect(isAllowedVercelPreviewBaseUrl(
      "https://cdas-next-preview123-linics1.vercel.app:443/",
      "cdas-next",
    )).toBe(true);
  });

  it.each([
    ["https://other-preview.vercel.app", "cdas-next"],
    ["https://cdas-next-.vercel.app", "cdas-next"],
    ["https://cdas-next-preview.vercel.app.evil.test", "cdas-next"],
    ["https://cdas-next.preview.vercel.app", "cdas-next"],
    ["https://user@cdas-next-preview.vercel.app", "cdas-next"],
    ["https://cdas-next-preview.vercel.app:444", "cdas-next"],
    ["https://cdas-next-preview.vercel.app/?x=1", "cdas-next"],
    ["https://cdas-next-preview.vercel.app/#x", "cdas-next"],
    ["https://cdas-next-preview.vercel.app/path", "cdas-next"],
    ["https://cdas-next-preview.vercel.app", "CDAS_NEXT"],
  ])("rejects a non-allowlisted origin", (url, project) => {
    expect(isAllowedVercelPreviewBaseUrl(url, project)).toBe(false);
  });
});
