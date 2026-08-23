import { describe, expect, it } from "vitest";

import {
  evaluateHealthResponse,
  isVercelDeploymentProtectionResponse,
} from "./application";

describe("evaluateHealthResponse", () => {
  it("accepts only the exact no-store health contract", () => {
    expect(
      evaluateHealthResponse({
        deploymentAccessModeVerified: true,
        status: 200,
        cacheControl: "no-store",
        body: { status: "ok", deploymentId: "a".repeat(40), configurationProof: "b".repeat(64), sourceFingerprint: "f".repeat(64) },
        expectedDeploymentId: "a".repeat(40),
        expectedConfigurationProof: "b".repeat(64),
        expectedSourceFingerprint: "f".repeat(64),
      }).status,
    ).toBe("PASS");
  });

  it.each([
    { status: 503, cacheControl: "no-store", body: { status: "ok" } },
    { status: 200, cacheControl: "public, max-age=60", body: { status: "ok" } },
    { status: 200, cacheControl: "no-store", body: { status: "ok", detail: "extra" } },
  ])("fails closed for a non-contract response", (input) => {
    expect(evaluateHealthResponse({ deploymentAccessModeVerified: true, ...input, expectedDeploymentId: "a".repeat(40), expectedConfigurationProof: "b".repeat(64), expectedSourceFingerprint: "f".repeat(64) }).status).toBe("FAIL");
  });
});

describe("Vercel Deployment Protection proof", () => {
  const healthUrl = "https://cdas-next-preview-linics1.vercel.app/api/health";
  const nonce = "a".repeat(64);
  const location = `https://vercel.com/sso-api?url=${encodeURIComponent(healthUrl)}&nonce=${nonce}`;
  const jsonChallenge = {
    error: { code: "401", message: "Protected deployment" },
    protection: { auto_vercel_auth_redirect: true, password_enabled: false, vercel_auth_callback: location, vercel_auth_enabled: true },
  };

  it("accepts only the expected Vercel SSO redirect challenge", () => {
    expect(isVercelDeploymentProtectionResponse({
      status: 302,
      server: "Vercel",
      vercelId: "sin1::abc",
      location,
      healthUrl,
    })).toBe(true);
  });

  it("accepts the exact Vercel JSON authentication challenge", () => {
    expect(isVercelDeploymentProtectionResponse({
      status: 401,
      server: "Vercel",
      vercelId: "sin1::abc",
      location: null,
      healthUrl,
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store, max-age=0",
      body: jsonChallenge,
    })).toBe(true);
  });

  it.each([
    { body: { ...jsonChallenge, extra: true } },
    { body: { ...jsonChallenge, error: { ...jsonChallenge.error, code: "403" } } },
    { body: { ...jsonChallenge, error: { ...jsonChallenge.error, message: "Authentication Required" } } },
    { body: { ...jsonChallenge, protection: { ...jsonChallenge.protection, vercel_auth_enabled: false } } },
    { body: { ...jsonChallenge, protection: { ...jsonChallenge.protection, password_enabled: true } } },
    { body: { ...jsonChallenge, protection: { ...jsonChallenge.protection, vercel_auth_callback: "https://evil.test/sso-api" } } },
    { contentType: "text/html" },
    { cacheControl: "public, max-age=60" },
    { cacheControl: "no-store, max-age=0, private" },
    { location },
  ])("rejects a malformed Vercel JSON authentication challenge", (override) => {
    expect(isVercelDeploymentProtectionResponse({
      status: 401,
      server: "Vercel",
      vercelId: "sin1::abc",
      location: null,
      healthUrl,
      contentType: "application/json",
      cacheControl: "no-store",
      body: jsonChallenge,
      ...override,
    })).toBe(false);
  });

  it.each([
    [200, "Vercel", "sin1::abc", location],
    [302, "nginx", "sin1::abc", location],
    [302, "Vercel", "", location],
    [302, "Vercel", "sin1::abc", `https://vercel.com/sso-api?url=https%3A%2F%2Fevil.test%2Fapi%2Fhealth&nonce=${nonce}`],
    [302, "Vercel", "sin1::abc", `https://evil.test/sso-api?url=${encodeURIComponent(healthUrl)}`],
    [302, "Vercel", "sin1::abc", `${location}&next=evil`],
    [302, "Vercel", "sin1::abc", `https://vercel.com/sso-api?url=${encodeURIComponent(healthUrl)}&nonce=short`],
  ])("rejects an unprotected or malformed challenge", (status, server, vercelId, candidateLocation) => {
    expect(isVercelDeploymentProtectionResponse({
      status,
      server,
      vercelId,
      location: candidateLocation,
      healthUrl,
    })).toBe(false);
  });

  it("makes the required health evidence fail closed without a verified access mode", () => {
    expect(evaluateHealthResponse({
      deploymentAccessModeVerified: false,
      status: 200,
      cacheControl: "no-store",
      body: { status: "ok", deploymentId: "a".repeat(40), configurationProof: "b".repeat(64), sourceFingerprint: "f".repeat(64) },
      expectedDeploymentId: "a".repeat(40),
      expectedConfigurationProof: "b".repeat(64),
      expectedSourceFingerprint: "f".repeat(64),
    }).status).toBe("FAIL");
  });
});
