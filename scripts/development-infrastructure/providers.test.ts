import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ClerkApiProvider, minimalCommandEnvironment, NeonApiProvider, verifyDownloadedAcceptanceArtifact } from "./providers";
import { VercelApiProvider } from "./remote-providers";
import { parseStagingEnvironmentFile, validateConfig } from "./contracts";

const config = validateConfig(parseStagingEnvironmentFile(`CDAS_DEVELOPMENT_INFRA_MANAGED=true
CDAS_INFRA_MASTER_SECRET=${"a".repeat(32)}
VERCEL_TOKEN=t
NEON_API_KEY=n
NEON_PROJECT_ID=project_123
CLERK_SECRET_KEY=sk_test_abcdefghijk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_abcdefghijk
`));
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function queuedFetch(responses: readonly Response[], requests: Request[]): typeof fetch { let index = 0; return (async (input: RequestInfo | URL, init?: RequestInit) => { requests.push(new Request(input, init)); const next = responses[index++]; if (!next) throw new Error("unexpected request"); return next; }) as typeof fetch; }

describe("provider fail-closed contracts", () => {
  it("keeps GitHub CLI state outside the repository by passing through absolute home paths", () => {
    const environment = minimalCommandEnvironment({ github: true });
    expect(environment.HOME).toBe(process.env.HOME);
    expect(path.isAbsolute(environment.HOME ?? "")).toBe(true);
    expect(path.isAbsolute(environment.GH_CONFIG_DIR ?? "")).toBe(true);
    expect(minimalCommandEnvironment()).not.toHaveProperty("HOME");
    expect(minimalCommandEnvironment()).not.toHaveProperty("GH_CONFIG_DIR");
  });
  it("rejects GitHub CLI home paths inside the repository, including symlink targets", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "cdas-github-home-"));
    try {
      const repository = path.join(sandbox, "repo");
      const outside = path.join(sandbox, "outside");
      const linked = path.join(sandbox, "linked-home");
      await mkdir(path.join(repository, "inside"), { recursive: true });
      await mkdir(outside);
      await symlink(path.join(repository, "inside"), linked);
      expect(() => minimalCommandEnvironment({ github: true, repositoryRoot: repository, environment: { PATH: "/bin", HOME: outside, GH_CONFIG_DIR: path.join(outside, "gh") } })).not.toThrow();
      expect(() => minimalCommandEnvironment({ github: true, repositoryRoot: repository, environment: { PATH: "/bin", HOME: path.join(repository, "inside") } })).toThrow("DEVELOPMENT_INFRA_GITHUB_HOME_UNSAFE");
      expect(() => minimalCommandEnvironment({ github: true, repositoryRoot: repository, environment: { PATH: "/bin", HOME: linked } })).toThrow("DEVELOPMENT_INFRA_GITHUB_HOME_UNSAFE");
      const outsideLink = path.join(sandbox, "outside-link");
      await symlink(outside, outsideLink);
      const fixed = minimalCommandEnvironment({ github: true, repositoryRoot: repository, environment: { PATH: "/bin", HOME: outsideLink, GH_CONFIG_DIR: path.join(outsideLink, "gh") } });
      await unlink(outsideLink);
      await symlink(path.join(repository, "inside"), outsideLink);
      const canonicalOutside = await realpath(outside);
      expect(fixed.HOME).toBe(canonicalOutside);
      expect(fixed.GH_CONFIG_DIR).toBe(path.join(canonicalOutside, "gh"));
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
  it("creates a zero-result Clerk identity and validates the created response", async () => {
    const calls: Request[] = [];
    const client = new ClerkApiProvider(config.clerkSecretKey, queuedFetch([response([]), response({ id: "user_one", external_id: "x", first_name: "A", last_name: "B" })], calls));
    await expect(client.ensureSyntheticIdentity("x", "A", "B")).resolves.toEqual({ id: "user_one", externalId: "x" });
    expect(calls.map((request) => request.method)).toEqual(["GET", "POST"]);
    expect(calls[1]?.headers.get("authorization")).toMatch(/^Bearer /u);
  });
  it("reuses exactly one matching Clerk identity and rejects conflict/multiple/api error", async () => {
    const existing = { id: "user_one", external_id: "x", first_name: "A", last_name: "B" };
    await expect(new ClerkApiProvider(config.clerkSecretKey, queuedFetch([response([existing])], [])).ensureSyntheticIdentity("x", "A", "B")).resolves.toEqual({ id: "user_one", externalId: "x" });
    await expect(new ClerkApiProvider(config.clerkSecretKey, queuedFetch([response([{ ...existing, last_name: "Wrong" }])], [])).ensureSyntheticIdentity("x", "A", "B")).rejects.toThrow("DEVELOPMENT_INFRA_CLERK_IDENTITY_CONFLICT");
    await expect(new ClerkApiProvider(config.clerkSecretKey, queuedFetch([response([existing, existing])], [])).ensureSyntheticIdentity("x", "A", "B")).rejects.toThrow("DEVELOPMENT_INFRA_CLERK_IDENTITY_AMBIGUOUS");
    await expect(new ClerkApiProvider(config.clerkSecretKey, queuedFetch([response({}, 403)], [])).ensureSyntheticIdentity("x", "A", "B")).rejects.toThrow("DEVELOPMENT_INFRA_PROVIDER_REQUEST_403");
  });
  it("refuses a non schema-only Neon branch before migrations or connections", async () => {
    const fetcher: typeof fetch = (async () => response({ branches: [{ id: "b", name: "cdas-next-development", branch_type: "copy-on-write", parent_id: null }] })) as typeof fetch;
    await expect(new NeonApiProvider(config, fetcher).ensureIsolatedDatabase()).rejects.toThrow("DEVELOPMENT_INFRA_NEON_BRANCH_UNSAFE");
  });
  it("reuses one exact safe Neon branch stack without duplicate writes", async () => {
    const requests: Request[] = [];
    const branch = { id: "branch", name: "cdas-next-development", init_source: "schema-only", parent_id: null, primary: false, default: false };
    const endpoint = { id: "endpoint", branch_id: "branch", type: "read_write", suspend_timeout_seconds: 300 };
    const fetcher = queuedFetch([
      response({ branches: [branch] }), response({ endpoints: [endpoint] }), response({ roles: [{ name: "cdas_staging_owner" }] }), response({ databases: [{ name: "cdas_next_staging", owner_name: "cdas_staging_owner" }] }), response({ uri: "postgresql://cdas_staging_owner:password@ep-pooler.example.neon.tech/cdas_next_staging?sslmode=require" }), response({ uri: "postgresql://cdas_staging_owner:password@ep.example.neon.tech/cdas_next_staging?sslmode=require" }),
    ], requests);
    await expect(new NeonApiProvider(config, fetcher).ensureIsolatedDatabase()).resolves.toEqual({ pooledUrl: "postgresql://cdas_staging_owner:password@ep-pooler.example.neon.tech/cdas_next_staging?sslmode=require", directUrl: "postgresql://cdas_staging_owner:password@ep.example.neon.tech/cdas_next_staging?sslmode=require" });
    expect(requests.map((item) => item.method)).toEqual(["GET", "GET", "GET", "GET", "GET", "GET"]);
    expect(requests[2]?.url).toContain("/branches/branch/roles");
    expect(requests[3]?.url).toContain("/branches/branch/databases");
  });
  it("uses bounded exact-name Neon branch pagination and rejects duplicate or looping pages", async () => {
    const branch = { id: "branch", name: "cdas-next-development", init_source: "schema-only", parent_id: null, primary: false, default: false };
    const requests: Request[] = [];
    const safe = queuedFetch([response({ branches: [], pagination: { next: "page-2" } }), response({ branches: [branch], pagination: { next: null } }), response({ endpoints: [{ id: "e", branch_id: "branch", type: "read_write", suspend_timeout_seconds: 0 }] }), response({ roles: [{ name: "cdas_staging_owner" }] }), response({ databases: [{ name: "cdas_next_staging", owner_name: "cdas_staging_owner" }] }), response({ uri: "postgresql://cdas_staging_owner:password@ep-pooler.example.neon.tech/cdas_next_staging?sslmode=require" }), response({ uri: "postgresql://cdas_staging_owner:password@ep.example.neon.tech/cdas_next_staging?sslmode=require" })], requests);
    await expect(new NeonApiProvider(config, safe).ensureIsolatedDatabase()).resolves.toBeDefined();
    expect(requests[0]?.url).toContain("search=cdas-next-development");
    expect(requests[1]?.url).toContain("cursor=page-2");
    await expect(new NeonApiProvider(config, queuedFetch([response({ branches: [branch], pagination: { next: "same" } }), response({ branches: [], pagination: { next: "same" } })], [])).ensureIsolatedDatabase()).rejects.toThrow("DEVELOPMENT_INFRA_NEON_BRANCH_PAGINATION_UNSAFE");
    await expect(new NeonApiProvider(config, queuedFetch([response({ branches: [branch, branch], pagination: { next: null } })], [])).ensureIsolatedDatabase()).rejects.toThrow("DEVELOPMENT_INFRA_NEON_BRANCH_AMBIGUOUS");
  });
  it("creates only a schema-only isolated Neon stack with branch-local roles/databases", async () => {
    const requests: Request[] = [];
    const branch = { id: "branch", name: "cdas-next-development", init_source: "schema-only", parent_id: null, primary: false, default: false };
    const endpoint = { id: "endpoint", branch_id: "branch", type: "read_write", suspend_timeout_seconds: 300 };
    const fetcher = queuedFetch([
      response({ branches: [] }), response({ branch }), response({ endpoints: [] }), response({ endpoint }), response({ roles: [] }), response({ role: { name: "cdas_staging_owner" } }), response({ databases: [] }), response({ database: { name: "cdas_next_staging", owner_name: "cdas_staging_owner" } }), response({ uri: "postgresql://cdas_staging_owner:password@ep-pooler.example.neon.tech/cdas_next_staging?sslmode=require" }), response({ uri: "postgresql://cdas_staging_owner:password@ep.example.neon.tech/cdas_next_staging?sslmode=require" }),
    ], requests);
    await new NeonApiProvider(config, fetcher).ensureIsolatedDatabase();
    expect(requests.map((request) => request.method)).toEqual(["GET", "POST", "GET", "POST", "GET", "POST", "GET", "POST", "GET", "GET"]);
    expect(await requests[1]?.json()).toEqual({ branch: { name: "cdas-next-development", init_source: "schema-only" } });
    expect(await requests[5]?.json()).toEqual({ role: { name: "cdas_staging_owner" } });
    expect(await requests[7]?.json()).toEqual({ database: { name: "cdas_next_staging", owner_name: "cdas_staging_owner" } });
  });
  it("rejects unsafe Neon primary branch, endpoint, or database owner", async () => {
    const base = { id: "branch", name: "cdas-next-development", init_source: "schema-only", parent_id: null, primary: false, default: false };
    await expect(new NeonApiProvider(config, queuedFetch([response({ branches: [{ ...base, primary: true }] })], [])).ensureIsolatedDatabase()).rejects.toThrow("DEVELOPMENT_INFRA_NEON_BRANCH_UNSAFE");
    await expect(new NeonApiProvider(config, queuedFetch([response({ branches: [base] }), response({ endpoints: [{ id: "e", branch_id: "branch", type: "read_write", suspend_timeout_seconds: -1 }] })], [])).ensureIsolatedDatabase()).rejects.toThrow("DEVELOPMENT_INFRA_NEON_ENDPOINT_UNSAFE");
    await expect(new NeonApiProvider(config, queuedFetch([response({ branches: [base] }), response({ endpoints: [{ id: "e", branch_id: "branch", type: "read_write", suspend_timeout_seconds: 300 }] }), response({ roles: [{ name: "cdas_staging_owner" }] }), response({ databases: [{ name: "cdas_next_staging", owner_name: "wrong" }] })], [])).ensureIsolatedDatabase()).rejects.toThrow("DEVELOPMENT_INFRA_NEON_DATABASE_UNSAFE");
  });
  it("accepts Neon optional root fields and zero timeout but rejects negative timeout", async () => {
    const branch = { id: "branch", name: "cdas-next-development", init_source: "schema-only", default: false };
    const safe = queuedFetch([response({ branches: [branch] }), response({ endpoints: [{ id: "e", branch_id: "branch", type: "read_write", suspend_timeout_seconds: 0 }] }), response({ roles: [{ name: "cdas_staging_owner" }] }), response({ databases: [{ name: "cdas_next_staging", owner_name: "cdas_staging_owner" }] }), response({ uri: "postgresql://cdas_staging_owner:password@ep-pooler.example.neon.tech/cdas_next_staging?sslmode=require" }), response({ uri: "postgresql://cdas_staging_owner:password@ep.example.neon.tech/cdas_next_staging?sslmode=require" })], []);
    await expect(new NeonApiProvider(config, safe).ensureIsolatedDatabase()).resolves.toBeDefined();
    const unsafe = queuedFetch([response({ branches: [branch] }), response({ endpoints: [{ id: "e", branch_id: "branch", type: "read_write", suspend_timeout_seconds: -1 }] })], []);
    await expect(new NeonApiProvider(config, unsafe).ensureIsolatedDatabase()).rejects.toThrow("DEVELOPMENT_INFRA_NEON_ENDPOINT_UNSAFE");
  });
  it("refuses unsafe Vercel build command before any preview configuration", async () => {
    const fetcher: typeof fetch = (async () => response({ name: "cdas-next", link: { type: "github", repoId: 1 }, buildCommand: "pnpm db:deploy && pnpm build" })) as typeof fetch;
    await expect(new VercelApiProvider("t", "cdas-next", undefined, fetcher).assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 })).rejects.toThrow("DEVELOPMENT_INFRA_VERCEL_BUILD_COMMAND_UNSAFE");
  });
  it("requires a known Vercel Preview SSO deployment protection mode", async () => {
    const fetcher: typeof fetch = (async () => response({ name: "cdas-next", link: { type: "github", repoId: 1 }, buildCommand: null, ssoProtection: { deploymentType: "unknown" } })) as typeof fetch;
    await expect(new VercelApiProvider("t", "cdas-next", undefined, fetcher).assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 })).rejects.toThrow("DEVELOPMENT_INFRA_VERCEL_PROTECTION_UNSAFE");
  });
  it("writes only the exact target preview branch and validates Vercel responses", async () => {
    const requests: Request[] = [];
    const project = { name: "cdas-next", link: { type: "github", repoId: 1, org: "o", repo: "r" }, buildCommand: "pnpm db:generate && pnpm build", ssoProtection: { deploymentType: "preview" }, protectionBypass: { ["A".repeat(32)]: { createdAt: 1 } } };
    const existing = { id: "env", key: "DATABASE_URL", type: "encrypted", target: ["preview"], gitBranch: "codex/x" };
    const client = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response(project), response({ envs: [existing, { ...existing, gitBranch: "codex/other" }] }), response(existing)], requests));
    await client.assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 });
    await client.ensurePreviewEnvironment({ DATABASE_URL: "value" });
    expect(requests[2]?.method).toBe("PATCH");
    expect(await requests[2]?.json()).toMatchObject({ gitBranch: "codex/x", target: ["preview"], type: "encrypted" });
    await expect(client.ensureProtectionBypass("A".repeat(32))).resolves.toBeUndefined();
    expect(requests).toHaveLength(3);
  });
  it("accepts the official Vercel env create envelope and rejects failed or plaintext entries", async () => {
    const project = { name: "cdas-next", link: { type: "github", repoId: 1 }, buildCommand: null, ssoProtection: { deploymentType: "all" }, protectionBypass: {} };
    const created = { id: "env", key: "DATABASE_URL", type: "encrypted", target: ["preview"], gitBranch: "codex/x" };
    const client = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response(project), response({ envs: [] }), response({ created, failed: [] })], []));
    await client.assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 });
    await expect(client.ensurePreviewEnvironment({ DATABASE_URL: "value" })).resolves.toBeUndefined();
    const failed = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response(project), response({ envs: [] }), response({ created, failed: [{ key: "DATABASE_URL" }] })], []));
    await failed.assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 });
    await expect(failed.ensurePreviewEnvironment({ DATABASE_URL: "value" })).rejects.toThrow("DEVELOPMENT_INFRA_VERCEL_ENV_RESPONSE_UNSAFE");
    const plaintext = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response(project), response({ envs: [] }), response({ created: { ...created, type: "plain" }, failed: [] })], []));
    await plaintext.assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 });
    await expect(plaintext.ensurePreviewEnvironment({ DATABASE_URL: "value" })).rejects.toThrow("DEVELOPMENT_INFRA_VERCEL_ENV_RESPONSE_UNSAFE");
  });
  it("normalizes Vercel preview targets from string or single-element array only", async () => {
    const project = { name: "cdas-next", link: { type: "github", repoId: 1 }, buildCommand: null, ssoProtection: { deploymentType: "preview" }, protectionBypass: {} };
    const entry = { id: "env", key: "DATABASE_URL", type: "encrypted", target: "preview", gitBranch: "codex/x" };
    const patch = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response(project), response({ envs: [entry] }), response(entry)], []));
    await patch.assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 });
    await expect(patch.ensurePreviewEnvironment({ DATABASE_URL: "value" })).resolves.toBeUndefined();
    const create = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response(project), response({ envs: [] }), response({ created: entry, failed: [] })], []));
    await create.assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 });
    await expect(create.ensurePreviewEnvironment({ DATABASE_URL: "value" })).resolves.toBeUndefined();
    const multi = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response(project), response({ envs: [] }), response({ created: { ...entry, target: ["preview", "production"] }, failed: [] })], []));
    await multi.assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 });
    await expect(multi.ensurePreviewEnvironment({ DATABASE_URL: "value" })).rejects.toThrow("DEVELOPMENT_INFRA_VERCEL_ENV_RESPONSE_UNSAFE");
  });
  it("accepts Vercel bypass only when the derived secret is a protectionBypass map key", async () => {
    const secret = "B".repeat(32);
    const project = { name: "cdas-next", link: { type: "github", repoId: 1 }, buildCommand: null, ssoProtection: { deploymentType: "preview" }, protectionBypass: {} };
    const client = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response(project), response({ protectionBypass: { [secret]: { createdAt: 1 } } })], []));
    await client.assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 });
    await expect(client.ensureProtectionBypass(secret)).resolves.toBeUndefined();
    const conflict = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response(project), response({}, 409), response({ ...project, protectionBypass: {} })], []));
    await conflict.assertProject({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 });
    await expect(conflict.ensureProtectionBypass(secret)).rejects.toThrow("DEVELOPMENT_INFRA_VERCEL_BYPASS_CONFLICT");
  });
  it.each([
    ["sha", { sha: "b".repeat(40), ref: "codex/x", repoId: 1 }, "https://cdas-next-abc.vercel.app", "DEVELOPMENT_INFRA_VERCEL_DEPLOYMENT_UNSAFE"],
    ["ref", { sha: "a".repeat(40), ref: "codex/y", repoId: 1 }, "https://cdas-next-abc.vercel.app", "DEVELOPMENT_INFRA_VERCEL_DEPLOYMENT_UNSAFE"],
    ["repo", { sha: "a".repeat(40), ref: "codex/x", repoId: 2 }, "https://cdas-next-abc.vercel.app", "DEVELOPMENT_INFRA_VERCEL_DEPLOYMENT_UNSAFE"],
    ["host", { sha: "a".repeat(40), ref: "codex/x", repoId: 1 }, "https://example.test", "DEVELOPMENT_INFRA_VERCEL_DEPLOYMENT_UNSAFE"],
  ] as const)("rejects Vercel READY deployment with wrong %s binding", async (_name, gitSource, url, code) => {
    const client = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response({ id: "deployment" }), response({ readyState: "READY", url: url.replace(/^https:\/\//u, ""), gitSource })], []), async () => undefined);
    await expect(client.deployPreview({ owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 })).rejects.toThrow(code);
  });
  it("accepts only exactly-bound Vercel READY Preview and rejects ERROR", async () => {
    const target = { owner: "o", name: "r", branch: "codex/x", sha: "a".repeat(40), repositoryId: 1 };
    const success = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response({ id: "deployment" }), response({ readyState: "READY", url: "cdas-next-abc.vercel.app", gitSource: { sha: target.sha, ref: target.branch, repoId: 1 } })], []), async () => undefined);
    await expect(success.deployPreview(target)).resolves.toEqual({ url: "https://cdas-next-abc.vercel.app", sha: target.sha });
    const error = new VercelApiProvider("t", "cdas-next", undefined, queuedFetch([response({ id: "deployment" }), response({ readyState: "ERROR" })], []), async () => undefined);
    await expect(error.deployPreview(target)).rejects.toThrow("DEVELOPMENT_INFRA_VERCEL_DEPLOYMENT_FAILED");
  });
  it("does not invoke a downloader for malformed acceptance run URLs", async () => {
    const runner = { run: async () => { throw new Error("downloader should not run"); } };
    await expect(verifyDownloadedAcceptanceArtifact({ id: "bad", attempt: 0, url: "https://github.com/o/r", headSha: "bad" }, runner)).rejects.toThrow("DEVELOPMENT_INFRA_GITHUB_RUN_URL_INVALID");
  });
  it("rejects an artifact run URL whose embedded id differs from run metadata", async () => {
    const runner = { run: async () => { throw new Error("downloader should not run"); } };
    await expect(verifyDownloadedAcceptanceArtifact({ id: "123", attempt: 1, url: "https://github.com/o/r/actions/runs/124", headSha: "a".repeat(40) }, runner)).rejects.toThrow("DEVELOPMENT_INFRA_GITHUB_RUN_URL_INVALID");
  });
  it("downloads the exact artifact into its uploaded staging-acceptance layout", async () => {
    const run = { id: "123", attempt: 2, url: "https://github.com/o/r/actions/runs/123", headSha: "a".repeat(40) };
    const calls: string[][] = [];
    const runner = { run: async (_command: string, args: readonly string[]) => { calls.push([...args]); if (args[0] === "run") { const directory = args[args.indexOf("--dir") + 1] as string; const marker = path.join(directory, "cdas-staging-123-2"); await mkdir(marker, { recursive: true }); await writeFile(path.join(marker, "final.json"), JSON.stringify({ schema: "staging-synthetic-acceptance-final.v1", status: "PASS", realStudentDataAllowed: false, productionDecision: "NO_GO" })); } return { stdout: "", stderr: "" }; } };
    await expect(verifyDownloadedAcceptanceArtifact(run, runner, { environment: {} })).resolves.toBeUndefined();
    expect(calls[0]).toContain("staging-synthetic-acceptance-123-2");
    expect(calls[0]?.[calls[0].indexOf("--dir") + 1]).toMatch(/output\/staging-acceptance$/u);
  });
});
