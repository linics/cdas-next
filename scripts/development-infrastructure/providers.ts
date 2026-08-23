import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DevelopmentInfrastructureConfig } from "./contracts";

export type RepositoryTarget = Readonly<{ owner: string; name: string; branch: string; sha: string; repositoryId: number }>;
export type ClerkIdentity = Readonly<{ id: string; externalId: string }>;
export type NeonConnection = Readonly<{ pooledUrl: string; directUrl: string }>;
export type PreviewDeployment = Readonly<{ url: string; sha: string }>;
export type WorkflowRun = Readonly<{ id: string; attempt: number; url: string; headSha: string }>;
export type ArtifactValidationContext = Readonly<{ environment: Readonly<Record<string, string>> }>;

export interface CommandRunner {
  run(command: string, args: readonly string[], options?: Readonly<{ env?: Readonly<Record<string, string>>; cwd?: string; input?: string; timeoutMs?: number }>): Promise<Readonly<{ stdout: string; stderr: string }>>;
}

function canonicalProspectivePath(target: string): string {
  let existing = path.resolve(target);
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("DEVELOPMENT_INFRA_GITHUB_HOME_UNSAFE");
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...missing);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function minimalCommandEnvironment(options: Readonly<{ github?: boolean; repositoryRoot?: string; environment?: Readonly<Record<string, string | undefined>> }> = {}): Readonly<Record<string, string>> {
  const source = options.environment ?? process.env;
  const base: Record<string, string> = { PATH: source.PATH ?? "" };
  if (options.github) {
    const home = source.HOME ?? "";
    const config = source.GH_CONFIG_DIR ?? path.join(home, ".config", "gh");
    if (!path.isAbsolute(home) || !path.isAbsolute(config)) throw new Error("DEVELOPMENT_INFRA_GITHUB_HOME_UNSAFE");
    const repositoryRoot = canonicalProspectivePath(options.repositoryRoot ?? process.cwd());
    const canonicalHome = canonicalProspectivePath(home);
    const canonicalConfig = canonicalProspectivePath(config);
    if (isInside(repositoryRoot, canonicalHome) || isInside(repositoryRoot, canonicalConfig)) throw new Error("DEVELOPMENT_INFRA_GITHUB_HOME_UNSAFE");
    base.HOME = canonicalHome;
    base.GH_CONFIG_DIR = canonicalConfig;
  }
  return base;
}

export interface ClerkProvider {
  assertDevelopmentInstance(): Promise<void>;
  ensureSyntheticIdentity(externalId: string, username: string, firstName: string, lastName: string): Promise<ClerkIdentity>;
}
export interface NeonProvider {
  ensureIsolatedDatabase(): Promise<NeonConnection>;
}
export interface VercelProvider {
  assertProject(repository: RepositoryTarget): Promise<void>;
  assertPrivateBlobConnection(): Promise<void>;
  ensurePreviewEnvironment(values: Readonly<Record<string, string>>): Promise<void>;
  ensureProtectionBypass(secret: string): Promise<void>;
  deployPreview(repository: RepositoryTarget): Promise<PreviewDeployment>;
}
export interface GitHubProvider {
  repositoryTarget(): Promise<RepositoryTarget>;
  ensureEnvironment(repository: RepositoryTarget): Promise<void>;
  setVariable(name: string, value: string): Promise<void>;
  setSecret(name: string, value: string): Promise<void>;
  dispatchAndVerify(repository: RepositoryTarget): Promise<WorkflowRun>;
  verifyDownloadedArtifact(run: WorkflowRun, context: ArtifactValidationContext): Promise<void>;
}

export interface InfrastructureProviders { clerk: ClerkProvider; neon: NeonProvider; vercel: VercelProvider; github: GitHubProvider; deployMigrations(connection: NeonConnection): Promise<void>; verifyApplication(input: Readonly<{ baseUrl: string; projectName: string; databaseUrl: string; clerkPublishableKey: string; clerkSecretKey: string; healthProofSecret: string; bypassSecret: string; deploymentSha: string }>): Promise<void>; }

export class SafeCommandRunner implements CommandRunner {
  async run(command: string, args: readonly string[], options: Readonly<{ env?: Readonly<Record<string, string>>; cwd?: string; input?: string; timeoutMs?: number }> = {}): Promise<Readonly<{ stdout: string; stderr: string }>> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { cwd: options.cwd ?? process.cwd(), env: options.env as NodeJS.ProcessEnv | undefined, stdio: "pipe" });
      let stdout = ""; let stderr = ""; let exceeded = false;
      const limit = 1_000_000;
      if (!child.stdin || !child.stdout || !child.stderr) { reject(new Error("DEVELOPMENT_INFRA_COMMAND_START_FAILED")); return; }
      const collect = (into: "stdout" | "stderr", chunk: Buffer) => { if (exceeded) return; const next = (into === "stdout" ? stdout : stderr) + chunk.toString("utf8"); if (next.length > limit) { exceeded = true; child.kill("SIGTERM"); return; } if (into === "stdout") stdout = next; else stderr = next; };
      child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
      const timer = setTimeout(() => { child.kill("SIGTERM"); }, options.timeoutMs ?? 30 * 60_000);
      child.on("error", () => reject(new Error("DEVELOPMENT_INFRA_COMMAND_START_FAILED")));
      child.on("close", (code: number | null) => { clearTimeout(timer); if (exceeded) reject(new Error("DEVELOPMENT_INFRA_COMMAND_OUTPUT_LIMIT")); else if (code === 0) resolve({ stdout, stderr }); else reject(new Error("DEVELOPMENT_INFRA_COMMAND_FAILED")); });
      child.stdin.end(options.input ?? "");
    });
  }
}

type Fetcher = typeof fetch;
async function json(fetcher: Fetcher, url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  const target = new URL(url);
  if (target.protocol !== "https:" || !["api.clerk.com", "console.neon.tech"].includes(target.hostname)) throw new Error("DEVELOPMENT_INFRA_PROVIDER_ORIGIN_UNSAFE");
  try { response = await fetcher(target, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) }); } catch { throw new Error("DEVELOPMENT_INFRA_PROVIDER_NETWORK_FAILED"); }
  if (!response.ok) throw new Error(`DEVELOPMENT_INFRA_PROVIDER_REQUEST_${response.status}`);
  return response.json().catch(() => { throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID"); });
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID"); return value as Record<string, unknown>; }
function text(value: unknown): string { return typeof value === "string" && value.length > 0 ? value : (() => { throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID"); })(); }
function headers(token: string): HeadersInit { return { authorization: `Bearer ${token}`, "content-type": "application/json" }; }

export class ClerkApiProvider implements ClerkProvider {
  constructor(private readonly secretKey: string, private readonly fetcher: Fetcher = fetch) {}
  async assertDevelopmentInstance(): Promise<void> {
    const payload = object(await json(this.fetcher, "https://api.clerk.com/v1/instance", { headers: headers(this.secretKey) }));
    if (payload.environment_type !== "development") throw new Error("DEVELOPMENT_INFRA_CLERK_INSTANCE_NOT_DEVELOPMENT");
  }
  async ensureSyntheticIdentity(externalId: string, username: string, firstName: string, lastName: string): Promise<ClerkIdentity> {
    const query = new URLSearchParams({ external_id: externalId, limit: "2" });
    const listed = await json(this.fetcher, `https://api.clerk.com/v1/users?${query}`, { headers: headers(this.secretKey) });
    if (!Array.isArray(listed)) throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID");
    if (listed.length > 1) throw new Error("DEVELOPMENT_INFRA_CLERK_IDENTITY_AMBIGUOUS");
    const user = listed[0] ?? object(await json(this.fetcher, "https://api.clerk.com/v1/users", { method: "POST", headers: headers(this.secretKey), body: JSON.stringify({ external_id: externalId, username, first_name: firstName, last_name: lastName, skip_password_requirement: true }) }));
    const target = object(user);
    const id = text(target.id);
    if (!/^user_[A-Za-z0-9]+$/u.test(id) || target.external_id !== externalId || target.username !== username || target.first_name !== firstName || target.last_name !== lastName) throw new Error("DEVELOPMENT_INFRA_CLERK_IDENTITY_CONFLICT");
    return { id, externalId };
  }
}

/** Deliberately validates every return shape; no unknown Neon branch is ever reused. */
export class NeonApiProvider implements NeonProvider {
  constructor(private readonly config: DevelopmentInfrastructureConfig, private readonly fetcher: Fetcher = fetch) {}
  private url(suffix: string): string { return `https://console.neon.tech/api/v2/projects/${encodeURIComponent(this.config.neonProjectId)}${suffix}`; }
  private init(method = "GET", body?: unknown): RequestInit { return { method, headers: headers(this.config.neonApiKey), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }; }
  private async assertSafeDefaultEndpointSuspendPolicy(): Promise<void> {
    const payload = object(await json(this.fetcher, this.url(""), this.init()));
    const project = object(payload.project);
    const settings = object(project.default_endpoint_settings);
    const suspendTimeout = settings.suspend_timeout_seconds;
    if (project.id !== this.config.neonProjectId || !Number.isInteger(suspendTimeout) || (suspendTimeout as number) < 0) throw new Error("DEVELOPMENT_INFRA_NEON_ENDPOINT_DEFAULT_UNSAFE");
  }
  async ensureIsolatedDatabase(): Promise<NeonConnection> {
    const branches: unknown[] = []; const seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ search: this.config.neonBranchName, limit: "100", ...(cursor ? { cursor } : {}) });
      const listed = object(await json(this.fetcher, this.url(`/branches?${query}`), this.init()));
      if (!Array.isArray(listed.branches)) throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID");
      branches.push(...listed.branches);
      const next = listed.pagination && typeof listed.pagination === "object" && !Array.isArray(listed.pagination) ? (listed.pagination as Record<string, unknown>).next : undefined;
      if (next === null || next === undefined || next === "") break;
      if (typeof next !== "string" || seen.has(next)) throw new Error("DEVELOPMENT_INFRA_NEON_BRANCH_PAGINATION_UNSAFE");
      seen.add(next); cursor = next;
      if (page === 19) throw new Error("DEVELOPMENT_INFRA_NEON_BRANCH_PAGINATION_UNSAFE");
    }
    const matches = branches.filter((entry) => object(entry).name === this.config.neonBranchName);
    if (matches.length > 1) throw new Error("DEVELOPMENT_INFRA_NEON_BRANCH_AMBIGUOUS");
    let createdEndpoint: Record<string, unknown> | undefined;
    let branch: Record<string, unknown>;
    if (matches[0]) {
      branch = object(matches[0]);
    } else {
      await this.assertSafeDefaultEndpointSuspendPolicy();
      const created = object(await json(this.fetcher, this.url("/branches"), this.init("POST", { branch: { name: this.config.neonBranchName, init_source: "schema-only" }, endpoints: [{ type: "read_write" }] })));
      branch = object(created.branch);
      if (!Array.isArray(created.endpoints) || created.endpoints.length !== 1) throw new Error("DEVELOPMENT_INFRA_NEON_ENDPOINT_AMBIGUOUS");
      createdEndpoint = object(created.endpoints[0]);
    }
    const branchId = text(branch.id);
    // Neon may report a requested schema-only root as parent-schema after copying only
    // the source schema. A missing parent remains mandatory so no data-bearing child
    // branch can be mistaken for this isolated development root.
    const schemaOnlyRoot = ["schema-only", "parent-schema"].includes(String(branch.init_source)) && (branch.parent_id === undefined || branch.parent_id === null);
    if (branch.name !== this.config.neonBranchName || !schemaOnlyRoot || !(branch.primary === undefined || branch.primary === false) || branch.default !== false) throw new Error("DEVELOPMENT_INFRA_NEON_BRANCH_UNSAFE");
    let endpoint: Record<string, unknown>;
    if (createdEndpoint) {
      endpoint = createdEndpoint;
    } else {
      const endpointPage = object(await json(this.fetcher, this.url("/endpoints"), this.init()));
      const endpoints = endpointPage.endpoints; if (!Array.isArray(endpoints)) throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID");
      const endpointMatches = endpoints.map(object).filter((item) => item.branch_id === branchId && item.type === "read_write");
      if (endpointMatches.length > 1) throw new Error("DEVELOPMENT_INFRA_NEON_ENDPOINT_AMBIGUOUS");
      if (endpointMatches[0]) {
        endpoint = endpointMatches[0];
      } else {
        await this.assertSafeDefaultEndpointSuspendPolicy();
        endpoint = object(object(await json(this.fetcher, this.url("/endpoints"), this.init("POST", { endpoint: { branch_id: branchId, type: "read_write" } }))).endpoint);
      }
    }
    if (endpoint.branch_id !== branchId || endpoint.type !== "read_write" || typeof endpoint.suspend_timeout_seconds !== "number" || endpoint.suspend_timeout_seconds < 0) throw new Error("DEVELOPMENT_INFRA_NEON_ENDPOINT_UNSAFE");
    const endpointId = text(endpoint.id);
    const rolesPage = object(await json(this.fetcher, this.url(`/branches/${encodeURIComponent(branchId)}/roles`), this.init()));
    const roles = rolesPage.roles; if (!Array.isArray(roles)) throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID");
    const roleMatches = roles.map(object).filter((item) => item.name === this.config.neonRoleName);
    if (roleMatches.length > 1) throw new Error("DEVELOPMENT_INFRA_NEON_ROLE_AMBIGUOUS");
    const role = roleMatches[0] ?? object(object(await json(this.fetcher, this.url(`/branches/${encodeURIComponent(branchId)}/roles`), this.init("POST", { role: { name: this.config.neonRoleName } }))).role);
    const roleName = text(role.name); if (roleName !== this.config.neonRoleName) throw new Error("DEVELOPMENT_INFRA_NEON_ROLE_UNSAFE");
    const databasesPage = object(await json(this.fetcher, this.url(`/branches/${encodeURIComponent(branchId)}/databases`), this.init()));
    const databases = databasesPage.databases; if (!Array.isArray(databases)) throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID");
    const databaseMatches = databases.filter((item) => object(item).name === this.config.neonDatabaseName);
    if (databaseMatches.length > 1) throw new Error("DEVELOPMENT_INFRA_NEON_DATABASE_AMBIGUOUS");
    const database = databaseMatches[0] ? object(databaseMatches[0]) : object(object(await json(this.fetcher, this.url(`/branches/${encodeURIComponent(branchId)}/databases`), this.init("POST", { database: { name: this.config.neonDatabaseName, owner_name: roleName } }))).database);
    if (database.name !== this.config.neonDatabaseName || database.owner_name !== roleName) throw new Error("DEVELOPMENT_INFRA_NEON_DATABASE_UNSAFE");
    const connection = async (pooled: boolean) => object(await json(this.fetcher, this.url(`/connection_uri?branch_id=${encodeURIComponent(branchId)}&endpoint_id=${encodeURIComponent(endpointId)}&database_name=${encodeURIComponent(this.config.neonDatabaseName)}&role_name=${encodeURIComponent(roleName)}&pooled=${pooled}`), this.init()));
    const pooled = text((await connection(true)).uri);
    const pooledTarget = new URL(pooled);
    const requiredParameter = (target: URL, name: string, value: string) => {
      const matches = target.searchParams.getAll(name);
      return matches.length === 1 && matches[0] === value;
    };
    const valid = (target: URL) => ["postgres:", "postgresql:"].includes(target.protocol) && target.hostname.endsWith(".neon.tech") && target.hostname !== "neon.tech" && decodeURIComponent(target.username) === roleName && target.password.length > 0 && target.pathname === `/${this.config.neonDatabaseName}` && requiredParameter(target, "sslmode", "require") && requiredParameter(target, "channel_binding", "require");
    const cluster = (hostname: string) => hostname.replace(/-pooler(?=\.)/u, "");
    if (!valid(pooledTarget) || !pooledTarget.hostname.includes("pooler")) throw new Error("DEVELOPMENT_INFRA_NEON_CONNECTION_UNSAFE");
    const direct = text((await connection(false)).uri);
    const directTarget = new URL(direct);
    if (!valid(directTarget) || cluster(pooledTarget.hostname) !== cluster(directTarget.hostname) || directTarget.hostname.includes("pooler")) throw new Error("DEVELOPMENT_INFRA_NEON_CONNECTION_UNSAFE");
    return { pooledUrl: pooled, directUrl: direct };
  }
}

export async function deployMigrationsWithMinimalEnvironment(connection: NeonConnection, runner: CommandRunner): Promise<void> {
  const migrationUrl = new URL(connection.directUrl);
  // Prisma's native schema engine can time out while Neon resumes a compute even
  // when the JavaScript driver connects successfully. Keep channel binding and
  // give only the migration connection a bounded cold-start window.
  migrationUrl.searchParams.set("connect_timeout", "60");
  await runner.run("pnpm", ["db:deploy"], { env: { PATH: process.env.PATH ?? "", DATABASE_URL: connection.pooledUrl, DIRECT_URL: migrationUrl.toString(), AI_PROVIDER_DISABLED: "1", NEXT_TELEMETRY_DISABLED: "1" } });
}

export async function verifyDownloadedAcceptanceArtifact(run: WorkflowRun, runner: CommandRunner, context: ArtifactValidationContext = { environment: {} }): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "cdas-development-infra-"));
  try {
    const urlRunId = /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)$/u.exec(run.url)?.[1];
    if (!/^\d+$/u.test(run.id) || urlRunId !== run.id || !/^[a-f0-9]{40}$/u.test(run.headSha) || !Number.isInteger(run.attempt) || run.attempt < 1) throw new Error("DEVELOPMENT_INFRA_GITHUB_RUN_URL_INVALID");
    const artifact = `staging-synthetic-acceptance-${run.id}-${run.attempt}`;
    const candidate = path.join(directory, "output", "staging-acceptance");
    await mkdir(candidate, { recursive: true });
    await runner.run("gh", ["run", "download", run.id, "--name", artifact, "--dir", candidate], { env: minimalCommandEnvironment({ github: true }) });
    const entries = await (await import("node:fs/promises")).readdir(candidate, { withFileTypes: true });
    const marker = `cdas-staging-${run.id}-${run.attempt}`;
    if (entries.length !== 1 || !entries[0]?.isDirectory() || entries[0].name !== marker) throw new Error("DEVELOPMENT_INFRA_ARTIFACT_FINAL_MISSING");
    const final = object(JSON.parse(await readFile(path.join(candidate, entries[0].name, "final.json"), "utf8")));
    if (final.schema !== "staging-synthetic-acceptance-final.v1" || final.status !== "PASS" || final.realStudentDataAllowed !== false || final.productionDecision !== "NO_GO") throw new Error("DEVELOPMENT_INFRA_ARTIFACT_NOT_PASS");
    await runner.run("node", ["--import", "tsx", path.join(process.cwd(), "scripts", "staging", "acceptance", "assert-final.ts")], { cwd: directory, env: { ...minimalCommandEnvironment(), ...context.environment, STAGING_RUN_MARKER: marker } });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DEVELOPMENT_INFRA_")) throw error;
    throw new Error("DEVELOPMENT_INFRA_ARTIFACT_INVALID");
  } finally { await rm(directory, { recursive: true, force: true }); }
}
