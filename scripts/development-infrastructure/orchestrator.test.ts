import { describe, expect, it } from "vitest";
import { parseStagingEnvironmentFile, validateConfig } from "./contracts";
import { reconcileDevelopmentInfrastructure } from "./orchestrator";
import type { InfrastructureProviders } from "./providers";

const config = validateConfig(parseStagingEnvironmentFile(`CDAS_DEVELOPMENT_INFRA_MANAGED=true
CDAS_INFRA_MASTER_SECRET=${"a".repeat(32)}
VERCEL_TOKEN=t
NEON_API_KEY=n
NEON_PROJECT_ID=project_123
CLERK_SECRET_KEY=sk_test_abcdefghijk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_abcdefghijk
`));

function providers(events: string[], failAt?: string): InfrastructureProviders {
  const hit = (name: string) => { events.push(name); if (name === failAt) throw new Error("DEVELOPMENT_INFRA_TEST_STOP"); };
  return {
    clerk: { assertDevelopmentInstance: async () => hit("clerk-instance"), ensureSyntheticIdentity: async (externalId) => { hit(`clerk-${externalId}`); return { id: `user_${externalId.replace(/-/gu, "")}`, externalId }; } },
    neon: { ensureIsolatedDatabase: async () => { hit("neon"); return { pooledUrl: "postgresql://x-pooler/staging", directUrl: "postgresql://x/staging" }; } },
    vercel: { assertProject: async () => hit("vercel-project"), assertPrivateBlobConnection: async () => hit("vercel-blob"), ensurePreviewEnvironment: async (values) => { hit("vercel-env"); expect(values.AI_PROVIDER_DISABLED).toBe("1"); expect(values.ATTACHMENT_STORAGE_ENABLED).toBe("1"); expect(values).not.toHaveProperty("DEEPSEEK_API_KEY"); }, ensureProtectionBypass: async () => hit("vercel-bypass"), deployPreview: async (target) => { hit("vercel-deploy"); return { url: "https://cdas-next-test.vercel.app", sha: target.sha }; } },
    github: { repositoryTarget: async () => { hit("target"); return { owner: "o", name: "r", branch: "codex/test", sha: "a".repeat(40), repositoryId: 1 }; }, ensureEnvironment: async () => hit("github-env"), setVariable: async (name) => { hit(`var-${name}`); }, setSecret: async (name) => { hit(`secret-${name}`); }, dispatchAndVerify: async () => { hit("dispatch"); return { id: "1", attempt: 1, url: "https://github.com/o/r/actions/runs/1", headSha: "a".repeat(40) }; }, verifyDownloadedArtifact: async () => hit("artifact") },
    deployMigrations: async () => hit("migrate"), verifyApplication: async () => hit("verify-app"),
  };
}

describe("development infrastructure reconciliation", () => {
  it("runs the isolated pipeline and writes only the explicit GitHub whitelist", async () => {
    const events: string[] = [];
    await expect(reconcileDevelopmentInfrastructure(config, providers(events))).resolves.toMatchObject({ environment: "staging-synthetic-acceptance" });
    expect(events.indexOf("migrate")).toBeGreaterThan(events.indexOf("neon"));
    expect(events.indexOf("dispatch")).toBeGreaterThan(events.indexOf("secret-STAGING_VERCEL_AUTOMATION_BYPASS_SECRET"));
    expect(events.filter((item) => item.startsWith("secret-")).sort()).toEqual(["secret-STAGING_BASE_URL", "secret-STAGING_CLERK_SECRET_KEY", "secret-STAGING_DATABASE_URL", "secret-STAGING_DIRECT_URL", "secret-STAGING_HEALTH_PROOF_SECRET", "secret-STAGING_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "secret-STAGING_TEST_OTHER_STUDENT_CLERK_ID", "secret-STAGING_TEST_OTHER_TEACHER_CLERK_ID", "secret-STAGING_TEST_STUDENT_CLERK_ID", "secret-STAGING_TEST_TEACHER_CLERK_ID", "secret-STAGING_VERCEL_AUTOMATION_BYPASS_SECRET"].sort());
  });
  it("fails closed without later remote steps", async () => {
    const events: string[] = [];
    await expect(reconcileDevelopmentInfrastructure(config, providers(events, "neon"))).rejects.toThrow("DEVELOPMENT_INFRA_TEST_STOP");
    expect(events).not.toContain("migrate");
    expect(events).toContain("vercel-project");
    expect(events).not.toContain("dispatch");
  });
  it("does no Clerk identity, Neon, Preview, or GitHub write after read-only Vercel protection failure", async () => {
    const events: string[] = [];
    await expect(reconcileDevelopmentInfrastructure(config, providers(events, "vercel-project"))).rejects.toThrow("DEVELOPMENT_INFRA_TEST_STOP");
    expect(events.filter((event) => event.startsWith("clerk-cdas-"))).toEqual([]);
    expect(events).not.toContain("neon");
    expect(events).not.toContain("vercel-env");
    expect(events).not.toContain("dispatch");
  });
  it("does no remote write when the Private Blob Preview connection is absent", async () => {
    const events: string[] = [];
    await expect(reconcileDevelopmentInfrastructure(config, providers(events, "vercel-blob"))).rejects.toThrow("DEVELOPMENT_INFRA_TEST_STOP");
    expect(events.filter((event) => event.startsWith("clerk-cdas-"))).toEqual([]);
    expect(events).not.toContain("neon");
    expect(events).not.toContain("vercel-env");
    expect(events).not.toContain("dispatch");
  });
});
