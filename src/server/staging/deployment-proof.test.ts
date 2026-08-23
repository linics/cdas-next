import { describe, expect, it } from "vitest";

import {
  createDeploymentConfigurationProof,
  isPublicHostname,
} from "./deployment-proof";

const input = {
  deploymentId: "a".repeat(40),
  databaseUrl: "postgresql://runtime:secret@project-pooler.example.com/cdas_next_staging?sslmode=require",
  sourceFingerprint: "f".repeat(64),
  clerkPublishableKey: "pk_test_abcdefghijklmnopqrstuv",
  clerkSecretKey: "sk_test_abcdefghijklmnopqrstuv",
  aiProviderDisabled: "1",
  secret: "h".repeat(32),
  challenge: "b".repeat(32),
};

describe("deployment proof", () => {
  it.each(["localhost.", "127.0.0.2", "10.0.0.1", "169.254.1.1", "[::1]", "[::ffff:127.0.0.1]", "service.internal"])("rejects non-public host %s", (host) => {
    expect(isPublicHostname(host)).toBe(false);
  });

  it("changes when a bound deployment property or challenge changes", () => {
    const proof = createDeploymentConfigurationProof(input);
    expect(proof).toMatch(/^[a-f0-9]{64}$/u);
    expect(createDeploymentConfigurationProof({ ...input, deploymentId: "c".repeat(40) })).not.toBe(proof);
    expect(createDeploymentConfigurationProof({ ...input, sourceFingerprint: "e".repeat(64) })).not.toBe(proof);
    expect(createDeploymentConfigurationProof({ ...input, challenge: "d".repeat(32) })).not.toBe(proof);
    expect(createDeploymentConfigurationProof({ ...input, clerkSecretKey: "sk_test_differentinstance12345" })).not.toBe(proof);
    expect(createDeploymentConfigurationProof({ ...input, databaseUrl: input.databaseUrl.replace("runtime:secret", "other:credentials") })).not.toBe(proof);
    expect(createDeploymentConfigurationProof({ ...input, databaseUrl: "postgresql://runtime:secret@project.example.com/cdas_next_staging?sslmode=require" })).toBeUndefined();
  });

  it("accepts disabled mode without AI fields but binds every valid enabled field", () => {
    expect(createDeploymentConfigurationProof(input)).toMatch(/^[a-f0-9]{64}$/u);
    const enabled = {
      ...input,
      aiProviderDisabled: "0",
      aiGatewayApiKey: "gateway-key-for-staging-012345",
      aiModel: "openai/gpt-5.6",
      aiToolApprovalSecret: "a".repeat(32),
    };
    const proof = createDeploymentConfigurationProof(enabled);
    expect(proof).toMatch(/^[a-f0-9]{64}$/u);
    expect(createDeploymentConfigurationProof({ ...enabled, aiGatewayApiKey: "rotated-gateway-key" })).not.toBe(proof);
    expect(createDeploymentConfigurationProof({ ...enabled, aiModel: "openai/gpt-5.7" })).not.toBe(proof);
    expect(createDeploymentConfigurationProof({ ...enabled, aiToolApprovalSecret: "b".repeat(32) })).not.toBe(proof);
    expect(createDeploymentConfigurationProof({ ...enabled, aiGatewayApiKey: "" })).toBeUndefined();
    expect(createDeploymentConfigurationProof({ ...enabled, aiGatewayApiKey: "short-key" })).toBeUndefined();
    expect(createDeploymentConfigurationProof({ ...enabled, aiModel: "invalid model" })).toBeUndefined();
    expect(createDeploymentConfigurationProof({ ...enabled, aiToolApprovalSecret: "too-short" })).toBeUndefined();
    expect(createDeploymentConfigurationProof({ ...input, aiProviderDisabled: "unexpected" })).toBeUndefined();
  });

  it("never exposes the Clerk secret or its hash in the proof", () => {
    const proof = createDeploymentConfigurationProof(input);

    expect(proof).not.toContain(input.clerkSecretKey);
    expect(JSON.stringify({ configurationProof: proof })).not.toContain(
      input.clerkSecretKey,
    );
    expect(JSON.stringify({ configurationProof: proof })).not.toContain(
      input.databaseUrl,
    );
  });
});
