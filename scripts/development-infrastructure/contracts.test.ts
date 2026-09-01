import { describe, expect, it } from "vitest";
import {
  deriveInfrastructureSecrets,
  generateSyntheticPasswords,
  parseStagingEnvironmentFile,
  redactInfrastructureText,
  stableInfrastructureErrorCode,
  syntheticFixtures,
  syntheticPasswordNames,
  validateConfig,
} from "./contracts";

const source = `CDAS_DEVELOPMENT_INFRA_MANAGED=true
CDAS_INFRA_MASTER_SECRET=${"a".repeat(32)}
VERCEL_TOKEN=token
NEON_API_KEY=key
NEON_PROJECT_ID=project
`;

describe("development infrastructure config", () => {
  it("loads only explicit values with safe defaults", () => {
    const config = validateConfig(parseStagingEnvironmentFile(source));
    expect(config.neonDatabaseName).toBe("cdas_next_staging");
    expect(config.vercelProjectName).toBe("cdas-next");
  });
  it.each(["", "CDAS_DEVELOPMENT_INFRA_MANAGED=false", "NEON_STAGING_DATABASE_NAME=cdas_next_production", "NEON_PROJECT_ID=production-project"])("rejects unsafe or incomplete input: %s", (line) => {
    const mutated = line ? source.replace(/^.*(?:CDAS_DEVELOPMENT_INFRA_MANAGED|NEON_STAGING_DATABASE_NAME|NEON_PROJECT_ID).*$/mu, line).concat(line.startsWith("NEON_") ? line + "\n" : "") : "";
    expect(() => validateConfig(parseStagingEnvironmentFile(mutated))).toThrow(/DEVELOPMENT_INFRA_/u);
  });
  it("defines distinct stable fixtures and six independent process-only passwords", () => {
    expect(syntheticFixtures.primarySchoolCode).toMatch(/^SCH[A-HJ-NP-Z2-9]{5}$/u);
    expect(new Set(Object.values(syntheticFixtures)).size).toBe(Object.values(syntheticFixtures).length);
    const passwords = generateSyntheticPasswords();
    expect(Object.keys(passwords).sort()).toEqual([...syntheticPasswordNames].sort());
    expect(new Set(Object.values(passwords)).size).toBe(6);
    expect(Object.values(passwords).every((value) => value.length >= 10)).toBe(true);
    expect(JSON.stringify({ schema: "fixture-proof", passwordsPresent: true })).not.toContain(Object.values(passwords)[0] ?? "");
  });
  it("derives stable domain-separated secrets and redacts values", () => {
    const secrets = deriveInfrastructureSecrets("a".repeat(32));
    expect(secrets.healthProofSecret).toMatch(/^[a-f0-9]{64}$/u);
    expect(secrets.vercelBypassSecret).toMatch(/^[A-Za-z0-9]{32}$/u);
    expect(secrets.vercelBypassSecret).not.toBe(secrets.healthProofSecret.slice(0, 32));
    expect(redactInfrastructureText("postgresql://x:y@db/z sk_test_abcdefghijk Bearer abc")).not.toContain("abcdefghijk");
    expect(stableInfrastructureErrorCode(new Error("postgresql://secret"))).toBe("DEVELOPMENT_INFRA_INTERNAL_ERROR");
  });
});
