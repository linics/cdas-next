import { createHmac } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { minimalCommandEnvironment, type CommandRunner } from "./providers";

export const infrastructureEnvironment = "staging-synthetic-acceptance";
export const syntheticExternalIds = {
  teacher: "cdas-staging-synthetic-teacher",
  student: "cdas-staging-synthetic-student",
  otherStudent: "cdas-staging-synthetic-other-student",
  otherTeacher: "cdas-staging-synthetic-other-teacher",
} as const;
export const syntheticUsernames = {
  teacher: "cdas_staging_synthetic_teacher",
  student: "cdas_staging_synthetic_student",
  otherStudent: "cdas_staging_synthetic_other_student",
  otherTeacher: "cdas_staging_synthetic_other_teacher",
} as const;

export type DevelopmentInfrastructureConfig = Readonly<{
  masterSecret: string;
  vercelToken: string;
  neonApiKey: string;
  neonProjectId: string;
  clerkSecretKey: string;
  clerkPublishableKey: string;
  vercelTeamId?: string;
  vercelProjectName: string;
  neonBranchName: string;
  neonDatabaseName: string;
  neonRoleName: string;
}>;

const required = [
  "CDAS_DEVELOPMENT_INFRA_MANAGED",
  "CDAS_INFRA_MASTER_SECRET",
  "VERCEL_TOKEN",
  "NEON_API_KEY",
  "NEON_PROJECT_ID",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
] as const;
const allowed = new Set([...required, "VERCEL_TEAM_ID", "VERCEL_PROJECT_NAME", "NEON_STAGING_BRANCH_NAME", "NEON_STAGING_DATABASE_NAME", "NEON_STAGING_ROLE_NAME"]);

function requiredValue(values: Readonly<Record<string, string>>, name: string): string {
  const value = values[name]?.trim() ?? "";
  if (!value) throw new Error(`DEVELOPMENT_INFRA_CONFIG_${name}_MISSING`);
  return value;
}

/** Strict, intentionally small dotenv parser: no expansion, commands, or process.env mutation. */
export function parseStagingEnvironmentFile(source: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [index, rawLine] of source.replace(/^\uFEFF/u, "").split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) throw new Error(`DEVELOPMENT_INFRA_CONFIG_LINE_${index + 1}_INVALID`);
    const [, name, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (/\s#/u.test(value)) {
      value = value.replace(/\s+#.*$/u, "").trim();
    }
    if (!value || value.includes("\u0000")) throw new Error(`DEVELOPMENT_INFRA_CONFIG_${name}_INVALID`);
    if (name in values) throw new Error(`DEVELOPMENT_INFRA_CONFIG_${name}_DUPLICATE`);
    if (!allowed.has(name)) throw new Error("DEVELOPMENT_INFRA_CONFIG_UNKNOWN_KEY");
    values[name] = value;
  }
  return Object.freeze(values);
}

/** Reads exactly the repository-root ignored regular file; no symlinks or loose permissions. */
export async function readValidatedStagingEnvironmentFile(repositoryRoot: string, runner: CommandRunner): Promise<string> {
  const root = path.resolve(repositoryRoot);
  const target = path.resolve(root, ".env.staging.local");
  if (path.dirname(target) !== root) throw new Error("DEVELOPMENT_INFRA_CONFIG_PATH_INVALID");
  let status;
  try { status = await lstat(target); } catch { throw new Error("DEVELOPMENT_INFRA_CONFIG_FILE_MISSING"); }
  if (!status.isFile() || status.isSymbolicLink()) throw new Error("DEVELOPMENT_INFRA_CONFIG_FILE_UNSAFE");
  if ((status.mode & 0o400) === 0 || (status.mode & 0o077) !== 0) throw new Error("DEVELOPMENT_INFRA_CONFIG_PERMISSIONS_UNSAFE");
  try { await runner.run("git", ["check-ignore", "--quiet", "--", ".env.staging.local"], { cwd: root, env: minimalCommandEnvironment() }); } catch { throw new Error("DEVELOPMENT_INFRA_CONFIG_NOT_IGNORED"); }
  try { return await readFile(target, "utf8"); } catch { throw new Error("DEVELOPMENT_INFRA_CONFIG_FILE_UNREADABLE"); }
}

export function validateConfig(values: Readonly<Record<string, string>>): DevelopmentInfrastructureConfig {
  for (const name of required) requiredValue(values, name);
  if (values.CDAS_DEVELOPMENT_INFRA_MANAGED !== "true") {
    throw new Error("DEVELOPMENT_INFRA_MANAGEMENT_NOT_ACKNOWLEDGED");
  }
  const masterSecret = requiredValue(values, "CDAS_INFRA_MASTER_SECRET");
  if (Buffer.byteLength(masterSecret, "utf8") < 32 || Buffer.byteLength(masterSecret, "utf8") > 4096) {
    throw new Error("DEVELOPMENT_INFRA_MASTER_SECRET_INVALID");
  }
  const projectName = (values.VERCEL_PROJECT_NAME ?? "cdas-next").trim();
  const branchName = (values.NEON_STAGING_BRANCH_NAME ?? "cdas-next-development").trim();
  const databaseName = (values.NEON_STAGING_DATABASE_NAME ?? "cdas_next_staging").trim();
  const roleName = (values.NEON_STAGING_ROLE_NAME ?? "cdas_staging_owner").trim();
  if (!/^sk_test_[A-Za-z0-9_-]{10,}$/u.test(requiredValue(values, "CLERK_SECRET_KEY"))) throw new Error("DEVELOPMENT_INFRA_CLERK_SECRET_NOT_TEST");
  if (!/^pk_test_[A-Za-z0-9_-]{10,}$/u.test(requiredValue(values, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"))) throw new Error("DEVELOPMENT_INFRA_CLERK_PUBLISHABLE_NOT_TEST");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(projectName) || /(?:prod|production|live)/u.test(projectName)) throw new Error("DEVELOPMENT_INFRA_VERCEL_PROJECT_INVALID");
  if (!/^[a-z0-9_-]{6,128}$/iu.test(requiredValue(values, "NEON_PROJECT_ID")) || /(?:prod|production|live)/u.test(requiredValue(values, "NEON_PROJECT_ID"))) throw new Error("DEVELOPMENT_INFRA_NEON_PROJECT_INVALID");
  if (!/^[a-z][a-z0-9_-]{2,62}$/u.test(databaseName) || !databaseName.includes("staging") || /prod(?:uction)?/u.test(databaseName)) throw new Error("DEVELOPMENT_INFRA_DATABASE_NAME_UNSAFE");
  if (!/^[a-z][a-z0-9_-]{2,62}$/u.test(roleName) || /prod(?:uction)?/u.test(roleName)) throw new Error("DEVELOPMENT_INFRA_ROLE_NAME_UNSAFE");
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/u.test(branchName) || /prod(?:uction)?/u.test(branchName)) throw new Error("DEVELOPMENT_INFRA_BRANCH_NAME_UNSAFE");
  return Object.freeze({ masterSecret, vercelToken: requiredValue(values, "VERCEL_TOKEN"), neonApiKey: requiredValue(values, "NEON_API_KEY"), neonProjectId: requiredValue(values, "NEON_PROJECT_ID"), clerkSecretKey: requiredValue(values, "CLERK_SECRET_KEY"), clerkPublishableKey: requiredValue(values, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"), vercelTeamId: values.VERCEL_TEAM_ID?.trim() || undefined, vercelProjectName: projectName, neonBranchName: branchName, neonDatabaseName: databaseName, neonRoleName: roleName });
}

export function deriveInfrastructureSecrets(masterSecret: string): Readonly<{ healthProofSecret: string; vercelBypassSecret: string }> {
  const derive = (purpose: string) => createHmac("sha256", masterSecret).update(`cdas-development-infrastructure-v1\0${purpose}`, "utf8").digest("hex");
  return Object.freeze({ healthProofSecret: derive("health-proof"), vercelBypassSecret: derive("vercel-protection-bypass").slice(0, 32) });
}

/** Never propagate provider body/header/error text into logs or artifacts. */
export function stableInfrastructureErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "DEVELOPMENT_INFRA_INTERNAL_ERROR";
  return /^DEVELOPMENT_INFRA_[A-Z0-9_]{3,120}$/u.test(message) ? message : "DEVELOPMENT_INFRA_INTERNAL_ERROR";
}

export function redactInfrastructureText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+\b/gu, "[REDACTED_CLERK_KEY]")
    .replace(/\b(?:Bearer|token|secret|ticket|cookie)\s*[:=]?\s*[^\s"']+/giu, "$1=[REDACTED]");
}
