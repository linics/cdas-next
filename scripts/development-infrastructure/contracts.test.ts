import { describe, expect, it } from "vitest";
import { deriveInfrastructureSecrets, parseStagingEnvironmentFile, redactInfrastructureText, stableInfrastructureErrorCode, validateConfig } from "./contracts";

const source = `CDAS_DEVELOPMENT_INFRA_MANAGED=true
CDAS_INFRA_MASTER_SECRET=${"a".repeat(32)}
VERCEL_TOKEN=token
NEON_API_KEY=key
NEON_PROJECT_ID=project
CLERK_SECRET_KEY=sk_test_abcdefghijk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_abcdefghijk
`;

describe("development infrastructure config", () => {
  it("loads only explicit values with safe defaults", () => {
    const config = validateConfig(parseStagingEnvironmentFile(source));
    expect(config.neonDatabaseName).toBe("cdas_next_staging");
    expect(config.vercelProjectName).toBe("cdas-next");
  });
  it.each(["", "CDAS_DEVELOPMENT_INFRA_MANAGED=false", "NEON_STAGING_DATABASE_NAME=cdas_next_production", "CLERK_SECRET_KEY=sk_live_abcdefghijk"])("rejects unsafe or incomplete input: %s", (line) => {
    const mutated = line ? source.replace(/^.*(?:CDAS_DEVELOPMENT_INFRA_MANAGED|NEON_STAGING_DATABASE_NAME|CLERK_SECRET_KEY).*$/mu, line).concat(line.startsWith("NEON_") ? line + "\n" : "") : "";
    expect(() => validateConfig(parseStagingEnvironmentFile(mutated))).toThrow(/DEVELOPMENT_INFRA_/u);
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
