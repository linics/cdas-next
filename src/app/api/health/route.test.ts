import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns only a bound uncached health response when configured", async () => {
    const original = { ...process.env };
    Object.assign(process.env, {
      CDAS_DEPLOYMENT_ID: "a".repeat(40),
      DATABASE_URL: "postgresql://runtime:secret@project-pooler.example.com/cdas_next_staging?sslmode=require",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abcdefghijklmnopqrstuv",
      CLERK_SECRET_KEY: "sk_test_abcdefghijklmnopqrstuv",
      AI_PROVIDER_DISABLED: "1",
      STAGING_HEALTH_PROOF_SECRET: "h".repeat(32),
      CDAS_SOURCE_FINGERPRINT: "f".repeat(64),
    });
    const response = GET(new Request("https://example.test/api/health", { headers: { "x-cdas-health-challenge": "b".repeat(32) } }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ status: "ok", deploymentId: "a".repeat(40), sourceFingerprint: "f".repeat(64), configurationProof: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    process.env = original;
  });

  it("fails closed without a valid build fingerprint and challenge", async () => {
    const original = { ...process.env };
    Object.assign(process.env, {
      CDAS_DEPLOYMENT_ID: "a".repeat(40),
      DATABASE_URL: "postgresql://runtime:secret@project-pooler.example.com/cdas_next_staging?sslmode=require",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abcdefghijklmnopqrstuv",
      CLERK_SECRET_KEY: "sk_test_abcdefghijklmnopqrstuv",
      AI_PROVIDER_DISABLED: "1",
      STAGING_HEALTH_PROOF_SECRET: "h".repeat(32),
      CDAS_SOURCE_FINGERPRINT: "",
    });
    const response = GET(new Request("https://example.test/api/health"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "unconfigured" });
    process.env = original;
  });

  it("binds enabled AI configuration without serializing any provider secret or hash", async () => {
    const original = { ...process.env };
    const apiKey = "gateway-key-for-staging";
    const approvalSecret = "approval-secret-for-staging-acceptance";
    Object.assign(process.env, {
      CDAS_DEPLOYMENT_ID: "a".repeat(40),
      DATABASE_URL: "postgresql://runtime:secret@project-pooler.example.com/cdas_next_staging?sslmode=require",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abcdefghijklmnopqrstuv",
      CLERK_SECRET_KEY: "sk_test_abcdefghijklmnopqrstuv",
      AI_PROVIDER_DISABLED: "0",
      AI_GATEWAY_API_KEY: apiKey,
      AI_MODEL: "openai/gpt-5.6",
      AI_TOOL_APPROVAL_SECRET: approvalSecret,
      STAGING_HEALTH_PROOF_SECRET: "h".repeat(32),
      CDAS_SOURCE_FINGERPRINT: "f".repeat(64),
    });

    const response = GET(new Request("https://example.test/api/health", { headers: { "x-cdas-health-challenge": "b".repeat(32) } }));
    const body = await response.json() as Record<string, string>;
    expect(response.status).toBe(200);
    expect(body.configurationProof).toMatch(/^[a-f0-9]{64}$/u);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(approvalSecret);
    expect(serialized).not.toContain("aiGatewayApiKeyHash");
    expect(serialized).not.toContain("aiToolApprovalSecretHash");
    process.env = original;
  });
});
