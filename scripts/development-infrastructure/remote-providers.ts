import { minimalCommandEnvironment, type ArtifactValidationContext, type CommandRunner, type GitHubProvider, type PreviewDeployment, type RepositoryTarget, type VercelProvider, type WorkflowRun } from "./providers";
import { verifyDownloadedAcceptanceArtifact } from "./providers";
import { infrastructureEnvironment } from "./contracts";
import { isAllowedVercelPreviewBaseUrl } from "../staging/preview-protection";

type Fetcher = typeof fetch;
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID"); return value as Record<string, unknown>; }
function string(value: unknown): string { if (typeof value !== "string" || !value) throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID"); return value; }
function isSinglePreviewTarget(value: unknown): boolean { return value === "preview" || (Array.isArray(value) && value.length === 1 && value[0] === "preview"); }
export class VercelApiProvider implements VercelProvider {
  private branch = "";
  private protectionBypass: unknown;
  constructor(private readonly token: string, private readonly projectName: string, private readonly teamId: string | undefined, private readonly fetcher: Fetcher = fetch, private readonly sleep: (milliseconds: number) => Promise<void> = async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) {}
  private endpoint(path: string): string { return `https://api.vercel.com${path}${this.teamId ? `${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(this.teamId)}` : ""}`; }
  private async request(url: string, method = "GET", body?: unknown): Promise<unknown> {
    if (new URL(url).origin !== "https://api.vercel.com") throw new Error("DEVELOPMENT_INFRA_PROVIDER_ORIGIN_UNSAFE");
    const run = async (): Promise<unknown> => {
      let response: Response;
      try {
        response = await this.fetcher(url, { method, headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(60_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      } catch {
        throw new Error("DEVELOPMENT_INFRA_PROVIDER_NETWORK_FAILED");
      }
      if (!response.ok) throw new Error(`DEVELOPMENT_INFRA_PROVIDER_REQUEST_${response.status}`);
      return response.status === 204 ? {} : response.json().catch(() => { throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID"); });
    };
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "DEVELOPMENT_INFRA_PROVIDER_NETWORK_FAILED") throw error;
      await this.sleep(2_000);
      return run();
    }
  }
  async assertProject(repository: RepositoryTarget): Promise<void> {
    const project = object(await this.request(this.endpoint(`/v9/projects/${encodeURIComponent(this.projectName)}`)));
    const link = object(project.link);
    const normalizedRepoId = typeof link.repoId === "number" ? link.repoId : Number(link.repoId);
    if (project.name !== this.projectName || link.type !== "github" || !Number.isSafeInteger(normalizedRepoId) || normalizedRepoId !== repository.repositoryId || (typeof link.org === "string" && link.org !== repository.owner) || (typeof link.repo === "string" && link.repo !== repository.name)) throw new Error("DEVELOPMENT_INFRA_VERCEL_PROJECT_LINK_UNSAFE");
    const buildCommand = project.buildCommand;
    if (!(buildCommand === null || buildCommand === "" || buildCommand === "pnpm db:generate && pnpm build")) throw new Error("DEVELOPMENT_INFRA_VERCEL_BUILD_COMMAND_UNSAFE");
    const deploymentType = project.ssoProtection && typeof project.ssoProtection === "object" && !Array.isArray(project.ssoProtection) ? (project.ssoProtection as Record<string, unknown>).deploymentType : undefined;
    if (!["all", "all_except_custom_domains", "preview", "prod_deployment_urls_and_all_previews"].includes(String(deploymentType))) throw new Error("DEVELOPMENT_INFRA_VERCEL_PROTECTION_UNSAFE");
    const targets = object(project.targets);
    const productionTarget = object(targets.production);
    const previewTarget = object(targets.preview);
    if (productionTarget.plan !== "hobby" || previewTarget.plan !== "hobby") throw new Error("DEVELOPMENT_INFRA_VERCEL_PLAN_NOT_HOBBY");
    if (this.teamId && project.accountId !== this.teamId) throw new Error("DEVELOPMENT_INFRA_VERCEL_TEAM_MISMATCH");
    this.protectionBypass = project.protectionBypass;
    this.branch = repository.branch;
  }
  async assertPrivateBlobConnection(): Promise<void> {
    if (!this.branch) throw new Error("DEVELOPMENT_INFRA_VERCEL_PROJECT_NOT_ASSERTED");
    const listed = object(await this.request(this.endpoint(`/v10/projects/${encodeURIComponent(this.projectName)}/env`)));
    const existing = Array.isArray(listed.envs) ? listed.envs.map(object) : (() => { throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID"); })();
    if (existing.some((entry) => entry.key === "BLOB_READ_WRITE_TOKEN")) throw new Error("DEVELOPMENT_INFRA_VERCEL_BLOB_LONG_LIVED_TOKEN_UNSAFE");
    for (const key of ["BLOB_STORE_ID", "BLOB_WEBHOOK_PUBLIC_KEY"] as const) {
      const matches = existing.filter((entry) => entry.key === key && isSinglePreviewTarget(entry.target) && (entry.gitBranch === undefined || entry.gitBranch === null || entry.gitBranch === ""));
      if (matches.length !== 1 || typeof matches[0]?.id !== "string" || !matches[0].id) throw new Error("DEVELOPMENT_INFRA_VERCEL_BLOB_CONNECTION_UNSAFE");
    }
  }
  async ensurePreviewEnvironment(values: Readonly<Record<string, string>>): Promise<void> {
    const listed = object(await this.request(this.endpoint(`/v10/projects/${encodeURIComponent(this.projectName)}/env`)));
    const existing = Array.isArray(listed.envs) ? listed.envs.map(object) : (() => { throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID"); })();
    for (const [key, value] of Object.entries(values)) {
      const match = existing.filter((entry) => entry.key === key && isSinglePreviewTarget(entry.target) && entry.gitBranch === this.branch);
      if (match.length > 1) throw new Error("DEVELOPMENT_INFRA_VERCEL_ENV_AMBIGUOUS");
      if (!this.branch) throw new Error("DEVELOPMENT_INFRA_VERCEL_PROJECT_NOT_ASSERTED");
      const body = { key, value, type: "encrypted", target: ["preview"], gitBranch: this.branch };
      const response = object(match[0] ? await this.request(this.endpoint(`/v9/projects/${encodeURIComponent(this.projectName)}/env/${encodeURIComponent(string(match[0].id))}`), "PATCH", body) : await this.request(this.endpoint(`/v10/projects/${encodeURIComponent(this.projectName)}/env`), "POST", body));
      const configured = match[0] ? response : object(response.created);
      if ((!match[0] && (!Array.isArray(response.failed) || response.failed.length !== 0)) || configured.key !== key || configured.type !== "encrypted" || configured.gitBranch !== this.branch || !isSinglePreviewTarget(configured.target)) throw new Error("DEVELOPMENT_INFRA_VERCEL_ENV_RESPONSE_UNSAFE");
    }
  }
  async removePaidPreviewEnvironment(): Promise<void> {
    if (!this.branch) throw new Error("DEVELOPMENT_INFRA_VERCEL_PROJECT_NOT_ASSERTED");
    const paidKeys = new Set(["DEEPSEEK_API_KEY", "AI_TOOL_APPROVAL_SECRET"]);
    const list = async () => {
      const value = object(await this.request(this.endpoint(`/v10/projects/${encodeURIComponent(this.projectName)}/env`)));
      if (!Array.isArray(value.envs)) throw new Error("DEVELOPMENT_INFRA_PROVIDER_SCHEMA_INVALID");
      return value.envs.map(object);
    };
    const matches = (await list()).filter((entry) => paidKeys.has(String(entry.key)) && entry.gitBranch === this.branch && isSinglePreviewTarget(entry.target));
    for (const key of paidKeys) {
      if (matches.filter((entry) => entry.key === key).length > 1) throw new Error("DEVELOPMENT_INFRA_VERCEL_ENV_AMBIGUOUS");
    }
    for (const entry of matches) {
      await this.request(this.endpoint(`/v9/projects/${encodeURIComponent(this.projectName)}/env/${encodeURIComponent(string(entry.id))}`), "DELETE");
    }
    const remaining = (await list()).filter((entry) => paidKeys.has(String(entry.key)) && entry.gitBranch === this.branch && isSinglePreviewTarget(entry.target));
    if (remaining.length !== 0) throw new Error("DEVELOPMENT_INFRA_VERCEL_PAID_ENV_NOT_REMOVED");
  }
  async ensureProtectionBypass(secret: string): Promise<void> {
    if (!/^[A-Za-z0-9]{32}$/u.test(secret)) throw new Error("DEVELOPMENT_INFRA_VERCEL_BYPASS_INVALID");
    const contains = (value: unknown): boolean => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, secret));
    if (contains(this.protectionBypass)) return;
    try { const result = object(await this.request(this.endpoint(`/v1/projects/${encodeURIComponent(this.projectName)}/protection-bypass`), "PATCH", { generate: { secret, note: "CDAS development synthetic acceptance" } })); if (!contains(result.protectionBypass)) throw new Error("DEVELOPMENT_INFRA_VERCEL_BYPASS_RESPONSE_UNSAFE"); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "DEVELOPMENT_INFRA_PROVIDER_REQUEST_409") throw error;
      const project = object(await this.request(this.endpoint(`/v9/projects/${encodeURIComponent(this.projectName)}`)));
      if (!contains(project.protectionBypass)) throw new Error("DEVELOPMENT_INFRA_VERCEL_BYPASS_CONFLICT");
    }
  }
  async deployPreview(repository: RepositoryTarget): Promise<PreviewDeployment> {
    const created = object(await this.request(this.endpoint("/v13/deployments?forceNew=1"), "POST", { name: this.projectName, gitSource: { type: "github", repoId: repository.repositoryId, ref: repository.branch, sha: repository.sha } }));
    const id = string(created.id);
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const deployment = object(await this.request(this.endpoint(`/v13/deployments/${encodeURIComponent(id)}?withGitRepoInfo=true`)));
      if (deployment.readyState === "READY") {
        const gitSource = object(deployment.gitSource);
        const url = `https://${string(deployment.url)}`;
        const repoId = typeof gitSource.repoId === "number" ? gitSource.repoId : Number(gitSource.repoId);
        if (gitSource.sha !== repository.sha || gitSource.ref !== repository.branch || repoId !== repository.repositoryId || !isAllowedVercelPreviewBaseUrl(url, this.projectName)) throw new Error("DEVELOPMENT_INFRA_VERCEL_DEPLOYMENT_UNSAFE");
        await this.assertProject(repository);
        return { url, sha: repository.sha };
      }
      if (deployment.readyState === "ERROR" || deployment.readyState === "CANCELED") throw new Error("DEVELOPMENT_INFRA_VERCEL_DEPLOYMENT_FAILED");
      await this.sleep(2_000);
    }
    throw new Error("DEVELOPMENT_INFRA_VERCEL_DEPLOYMENT_TIMEOUT");
  }
}

export class GitHubCliProvider implements GitHubProvider {
  constructor(private readonly runner: CommandRunner, private readonly sleep: (milliseconds: number) => Promise<void> = async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) {}
  private async gh(args: readonly string[], input?: string): Promise<Readonly<{ stdout: string; stderr: string }>> {
    const run = () => this.runner.run("gh", args, { env: minimalCommandEnvironment({ github: true }), input });
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "DEVELOPMENT_INFRA_COMMAND_FAILED") throw error;
      await this.sleep(2_000);
      return run();
    }
  }
  async repositoryTarget(): Promise<RepositoryTarget> {
    const [branch, sha, repo, remote, status] = await Promise.all([
      this.runner.run("git", ["branch", "--show-current"], { env: minimalCommandEnvironment() }), this.runner.run("git", ["rev-parse", "HEAD"], { env: minimalCommandEnvironment() }), this.gh(["api", "repos/{owner}/{repo}", "--jq", "[.full_name,.id] | @tsv"]), this.runner.run("git", ["remote", "get-url", "origin"], { env: minimalCommandEnvironment() }), this.runner.run("git", ["status", "--porcelain"], { env: minimalCommandEnvironment() }),
    ]);
    const current = branch.stdout.trim(); const commit = sha.stdout.trim(); const [ownerAndName, databaseId] = repo.stdout.trim().split("\t");
    const match = /^([^/]+)\/([^/]+)$/u.exec(ownerAndName ?? "");
    const remoteMatch = /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(remote.stdout.trim());
    if (status.stdout !== "" || !match || !remoteMatch || remoteMatch[1] !== match[1] || remoteMatch[2] !== match[2] || !/^codex\/[a-z0-9._/-]+$/u.test(current) || !/^[a-f0-9]{40}$/u.test(commit) || !/^\d+$/u.test(databaseId ?? "")) throw new Error("DEVELOPMENT_INFRA_GIT_TARGET_UNSAFE");
    const remoteRef = await this.gh(["api", `repos/{owner}/{repo}/git/ref/heads/${current}`, "--jq", ".object.sha"]);
    const remoteSha = remoteRef.stdout.trim();
    if (remoteSha !== commit) throw new Error("DEVELOPMENT_INFRA_GIT_REMOTE_STALE");
    return { owner: match[1], name: match[2], branch: current, sha: commit, repositoryId: Number(databaseId) };
  }
  async ensureEnvironment(repository: RepositoryTarget): Promise<void> {
    const environmentPath = `repos/${repository.owner}/${repository.name}/environments/${infrastructureEnvironment}`;
    // GitHub treats even a zero wait_timer as configuring a wait-timer rule,
    // which is unavailable for private repositories on some plans. Omitting
    // unrelated protection fields preserves their existing defaults while the
    // supported deployment-branch policy remains explicit and fail-closed.
    await this.gh(["api", "--method", "PUT", environmentPath, "--input", "-"], JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }));
    const listPolicies = async () => {
      const pages = JSON.parse((await this.gh(["api", `${environmentPath}/deployment-branch-policies`, "--paginate", "--slurp"])).stdout) as unknown;
      if (!Array.isArray(pages) || pages.length === 0) throw new Error("DEVELOPMENT_INFRA_GITHUB_POLICY_SCHEMA_INVALID");
      return pages.flatMap((page) => {
        const branches = object(page).branch_policies;
        if (!Array.isArray(branches)) throw new Error("DEVELOPMENT_INFRA_GITHUB_POLICY_SCHEMA_INVALID");
        return branches.map(object);
      });
    };
    const existing = await listPolicies();
    for (const policy of existing) {
      if (policy.name === "codex/*") {
        const id = typeof policy.id === "number" ? String(policy.id) : typeof policy.id === "string" ? policy.id : "";
        if (!/^\d+$/u.test(id)) throw new Error("DEVELOPMENT_INFRA_GITHUB_POLICY_SCHEMA_INVALID");
        await this.gh(["api", "--method", "DELETE", `${environmentPath}/deployment-branch-policies/${id}`]);
      } else if (policy.name !== repository.branch) throw new Error("DEVELOPMENT_INFRA_GITHUB_POLICY_UNSAFE");
    }
    const afterDelete = await listPolicies();
    if (afterDelete.some((policy) => policy.name !== repository.branch)) throw new Error("DEVELOPMENT_INFRA_GITHUB_POLICY_UNSAFE");
    if (afterDelete.length === 0) await this.gh(["api", "--method", "POST", `${environmentPath}/deployment-branch-policies`, "--input", "-"], JSON.stringify({ name: repository.branch }));
    const finalPolicies = await listPolicies();
    if (finalPolicies.length !== 1 || finalPolicies[0]?.name !== repository.branch || !/^(?:\d+|[A-Za-z0-9_-]+)$/u.test(String(finalPolicies[0]?.id ?? ""))) throw new Error("DEVELOPMENT_INFRA_GITHUB_POLICY_UNSAFE");
  }
  async setVariable(name: string, value: string): Promise<void> {
    const allowed = new Set(["STAGING_VERCEL_PROJECT_NAME", "STAGING_DATABASE_NAME", "STAGING_SYNTHETIC_ONLY_ATTESTED", "STAGING_CLERK_INSTANCE_ATTESTED", "STAGING_DATABASE_ISOLATION_ATTESTED", "STAGING_HOSTING_ACCESS_ATTESTED", "STAGING_ROLLBACK_OWNER_ATTESTED", "STAGING_RETENTION_ATTESTED", "STAGING_ACCEPTANCE_WRITES_ATTESTED", "STAGING_ACCEPTANCE_CLERK_TOKENS_ATTESTED", "STAGING_ACCEPTANCE_RETENTION_ATTESTED"]);
    if (!allowed.has(name)) throw new Error("DEVELOPMENT_INFRA_GITHUB_VARIABLE_UNSAFE");
    const listed = await this.gh(["variable", "list", "--env", infrastructureEnvironment, "--json", "name,value"]);
    const variables = JSON.parse(listed.stdout) as unknown;
    if (!Array.isArray(variables)) throw new Error("DEVELOPMENT_INFRA_GITHUB_VARIABLE_SCHEMA_INVALID");
    if (variables.map(object).some((item) => item.name === name && item.value === value)) return;
    await this.gh(["variable", "set", name, "--env", infrastructureEnvironment, "--body", value]);
  }
  async setSecret(name: string, value: string): Promise<void> {
    const allowed = /^STAGING_(?:BASE_URL|DATABASE_URL|DIRECT_URL|NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY|CLERK_SECRET_KEY|TEST_(?:TEACHER|STUDENT|OTHER_STUDENT|OTHER_TEACHER)_CLERK_ID|HEALTH_PROOF_SECRET|VERCEL_AUTOMATION_BYPASS_SECRET)$/u;
    if (!allowed.test(name)) throw new Error("DEVELOPMENT_INFRA_GITHUB_SECRET_UNSAFE");
    const run = () =>
      this.runner.run("gh", ["secret", "set", name, "--env", infrastructureEnvironment], {
        env: minimalCommandEnvironment({ github: true }),
        input: value,
      });
    try {
      await run();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "DEVELOPMENT_INFRA_COMMAND_FAILED") throw error;
      await this.sleep(2_000);
      await run();
    }
  }
  async dispatchAndVerify(repository: RepositoryTarget): Promise<WorkflowRun> {
    const before = await this.gh(["run", "list", "--workflow", "staging-synthetic-acceptance.yml", "--branch", repository.branch, "--limit", "100", "--json", "databaseId"]);
    const previous = JSON.parse(before.stdout) as unknown;
    if (!Array.isArray(previous)) throw new Error("DEVELOPMENT_INFRA_GITHUB_RUN_SCHEMA_INVALID");
    const watermark = new Set(previous.map(object).map((item) => String(item.databaseId)));
    await this.gh(["workflow", "run", "staging-synthetic-acceptance.yml", "--ref", repository.branch]);
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const listed = await this.gh(["run", "list", "--workflow", "staging-synthetic-acceptance.yml", "--branch", repository.branch, "--limit", "100", "--json", "databaseId,attempt,event,headBranch,headSha,url,status,conclusion"]);
      const runs = JSON.parse(listed.stdout) as unknown;
      if (!Array.isArray(runs)) throw new Error("DEVELOPMENT_INFRA_GITHUB_RUN_SCHEMA_INVALID");
      const matches = runs.map(object).filter((item) => !watermark.has(String(item.databaseId)) && item.event === "workflow_dispatch" && item.headBranch === repository.branch && item.headSha === repository.sha);
      if (matches.length > 1) throw new Error("DEVELOPMENT_INFRA_GITHUB_RUN_AMBIGUOUS");
      const run = matches[0];
      if (run) {
        const id = String(run.databaseId); if (!/^\d+$/u.test(id)) throw new Error("DEVELOPMENT_INFRA_GITHUB_RUN_SCHEMA_INVALID"); const view = object(JSON.parse((await this.gh(["run", "view", id, "--json", "databaseId,attempt,event,headBranch,headSha,url,status,conclusion"])).stdout));
        if (String(view.databaseId) !== id || view.event !== "workflow_dispatch" || view.headBranch !== repository.branch || view.headSha !== repository.sha) throw new Error("DEVELOPMENT_INFRA_GITHUB_RUN_IDENTITY_CHANGED");
        if (view.status === "completed") { if (view.conclusion !== "success") throw new Error("DEVELOPMENT_INFRA_GITHUB_RUN_FAILED"); const runAttempt = Number(view.attempt); const url = string(view.url); if (!Number.isInteger(runAttempt) || runAttempt < 1 || url !== `https://github.com/${repository.owner}/${repository.name}/actions/runs/${id}`) throw new Error("DEVELOPMENT_INFRA_GITHUB_RUN_IDENTITY_CHANGED"); return { id, attempt: runAttempt, url, headSha: repository.sha }; }
      }
      await this.sleep(20_000);
    }
    throw new Error("DEVELOPMENT_INFRA_GITHUB_RUN_TIMEOUT");
  }
  async verifyDownloadedArtifact(run: WorkflowRun, context: ArtifactValidationContext): Promise<void> { await verifyDownloadedAcceptanceArtifact(run, this.runner, context); }
}
