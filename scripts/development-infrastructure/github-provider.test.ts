import { describe, expect, it } from "vitest";
import { GitHubCliProvider } from "./remote-providers";
import type { CommandRunner } from "./providers";

type Call = Readonly<{ command: string; args: readonly string[]; input?: string }>;
function target() { return { owner: "owner", name: "repo", branch: "codex/test", sha: "a".repeat(40), repositoryId: 42 }; }

describe("GitHub CLI provider", () => {
  it("rejects a stale remote branch rather than accepting branch existence", async () => {
    const runner: CommandRunner = { run: async (command, args) => {
      if (command === "git" && args[0] === "branch") return { stdout: "codex/test\n", stderr: "" };
      if (command === "git" && args[0] === "rev-parse") return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
      if (command === "git" && args[0] === "remote") return { stdout: "git@github.com:owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "status") return { stdout: "", stderr: "" };
      if (command === "gh" && args[1]?.includes("/git/ref/heads/")) return { stdout: `${"b".repeat(40)}\n`, stderr: "" };
      return { stdout: "owner/repo\t42\n", stderr: "" };
    } };
    await expect(new GitHubCliProvider(runner).repositoryTarget()).rejects.toThrow("DEVELOPMENT_INFRA_GIT_REMOTE_STALE");
  });
  it("accepts a clean working tree and rejects a dirty one", async () => {
    const calls: Call[] = [];
    const build = (dirty: boolean): CommandRunner => ({ run: async (command, args) => {
      calls.push({ command, args });
      if (command === "git" && args[0] === "branch") return { stdout: "codex/test\n", stderr: "" };
      if (command === "git" && args[0] === "rev-parse") return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
      if (command === "git" && args[0] === "remote") return { stdout: "git@github.com:owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "status") return { stdout: dirty ? " M package.json\n" : "", stderr: "" };
      if (command === "gh" && args[1]?.includes("/git/ref/heads/")) return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
      return { stdout: "owner/repo\t42\n", stderr: "" };
    } });
    await expect(new GitHubCliProvider(build(false)).repositoryTarget()).resolves.toEqual(target());
    await expect(new GitHubCliProvider(build(true)).repositoryTarget()).rejects.toThrow("DEVELOPMENT_INFRA_GIT_TARGET_UNSAFE");
    expect(calls.some((call) => call.command === "gh" && call.args.join(" ") === "api repos/{owner}/{repo} --jq [.full_name,.id] | @tsv")).toBe(true);
    expect(calls.some((call) => call.command === "gh" && call.args.join(" ") === "api repos/{owner}/{repo}/git/ref/heads/codex/test --jq .object.sha")).toBe(true);
    expect(calls.some((call) => call.args.includes("databaseId"))).toBe(false);
    expect(calls.some((call) => call.args.includes("ls-remote"))).toBe(false);
  });
  it("rejects a lookalike non-GitHub origin", async () => {
    const runner: CommandRunner = { run: async (command, args) => {
      if (command === "git" && args[0] === "branch") return { stdout: "codex/test\n", stderr: "" };
      if (command === "git" && args[0] === "rev-parse") return { stdout: `${"a".repeat(40)}\n`, stderr: "" };
      if (command === "git" && args[0] === "remote") return { stdout: "https://evilgithub.com/owner/repo.git\n", stderr: "" };
      if (command === "git" && args[0] === "status") return { stdout: "", stderr: "" };
      return { stdout: "owner/repo\t42\n", stderr: "" };
    } };
    await expect(new GitHubCliProvider(runner).repositoryTarget()).rejects.toThrow("DEVELOPMENT_INFRA_GIT_TARGET_UNSAFE");
  });
  it("sets only policy changes and sends environment JSON through stdin", async () => {
    const calls: Call[] = [];
    let policyReads = 0;
    const runner: CommandRunner = { run: async (command, args, options) => { calls.push({ command, args, input: options?.input }); if (args[0] === "api" && args.includes("--slurp")) { policyReads += 1; return { stdout: JSON.stringify([{ branch_policies: policyReads === 3 ? [{ id: 1, name: "codex/test" }] : [] }]), stderr: "" }; } if (args[0] === "variable" && args[1] === "list") return { stdout: "[]", stderr: "" }; return { stdout: "", stderr: "" }; } };
    const provider = new GitHubCliProvider(runner);
    await provider.ensureEnvironment(target());
    await provider.setVariable("STAGING_DATABASE_NAME", "cdas_next_staging");
    await provider.setSecret("STAGING_DATABASE_URL", "postgresql://secret");
    const secret = calls.find((call) => call.args[0] === "secret");
    expect(secret?.args.join(" ")).not.toContain("postgresql://secret");
    expect(secret?.input).toBe("postgresql://secret");
    expect(JSON.parse(calls.find((call) => call.args.includes("PUT"))?.input ?? "null")).toEqual({
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    });
  });
  it("removes only legacy codex wildcard then re-reads one exact current policy", async () => {
    const calls: Call[] = []; let reads = 0;
    const runner: CommandRunner = { run: async (command, args, options) => { calls.push({ command, args, input: options?.input }); if (args[0] === "api" && args.includes("--slurp")) { reads += 1; return { stdout: JSON.stringify([{ branch_policies: reads === 1 ? [{ id: 7, name: "codex/*" }] : reads === 3 ? [{ id: 8, name: "codex/test" }] : [] }]), stderr: "" }; } return { stdout: "", stderr: "" }; } };
    await expect(new GitHubCliProvider(runner).ensureEnvironment(target())).resolves.toBeUndefined();
    expect(calls.some((call) => call.args.includes("DELETE") && call.args.some((arg) => arg.endsWith("/7")))).toBe(true);
    expect(reads).toBe(3);
  });
  it.each([
    [[{ id: 7, name: "codex/*" }], [{ id: 7, name: "codex/*" }]],
    [[{ id: 1, name: "codex/test" }, { id: 2, name: "codex/test" }], []],
    [[{ id: 7, name: "main" }], []],
  ] as const)("fails closed when policies cannot converge to one exact branch", async (first, second) => {
    let reads = 0;
    const runner: CommandRunner = { run: async (_command, args) => { if (args[0] === "api" && args.includes("--slurp")) { reads += 1; return { stdout: JSON.stringify([{ branch_policies: reads === 1 ? first : second }]), stderr: "" }; } return { stdout: "", stderr: "" }; } };
    await expect(new GitHubCliProvider(runner).ensureEnvironment(target())).rejects.toThrow("DEVELOPMENT_INFRA_GITHUB_POLICY_UNSAFE");
  });
  it.each(["codex/*", "main"])("does not silently omit an unsafe policy on a later page: %s", async (name) => {
    const runner: CommandRunner = { run: async (_command, args) => {
      if (args[0] === "api" && args.includes("--slurp")) return { stdout: JSON.stringify([{ branch_policies: [{ id: 1, name: "codex/test" }] }, { branch_policies: [{ id: 2, name }] }]), stderr: "" };
      return { stdout: "", stderr: "" };
    } };
    await expect(new GitHubCliProvider(runner).ensureEnvironment(target())).rejects.toThrow("DEVELOPMENT_INFRA_GITHUB_POLICY_UNSAFE");
  });
  it("uses a post-dispatch watermark and exact run identity", async () => {
    let listCount = 0;
    const runner: CommandRunner = { run: async (command, args) => {
      if (command !== "gh") return { stdout: "", stderr: "" };
      if (args[0] === "run" && args[1] === "list") { listCount += 1; return { stdout: JSON.stringify(listCount === 1 ? [{ databaseId: 1 }] : [{ databaseId: 1 }, { databaseId: 2, attempt: 1, event: "workflow_dispatch", headBranch: "codex/test", headSha: "a".repeat(40), url: "https://github.com/owner/repo/actions/runs/2", status: "completed", conclusion: "success" }]), stderr: "" }; }
      if (args[0] === "run" && args[1] === "view") return { stdout: JSON.stringify({ databaseId: 2, attempt: 1, event: "workflow_dispatch", headBranch: "codex/test", headSha: "a".repeat(40), url: "https://github.com/owner/repo/actions/runs/2", status: "completed", conclusion: "success" }), stderr: "" };
      return { stdout: "", stderr: "" };
    } };
    await expect(new GitHubCliProvider(runner, async () => undefined).dispatchAndVerify(target())).resolves.toEqual({ id: "2", attempt: 1, url: "https://github.com/owner/repo/actions/runs/2", headSha: "a".repeat(40) });
  });
  it("rejects workflow run URLs bound to another repository, host, or id", async () => {
    for (const url of ["https://github.com/other/repo/actions/runs/2", "https://evil.test/owner/repo/actions/runs/2", "https://github.com/owner/repo/actions/runs/3"]) {
      let listCount = 0;
      const runner: CommandRunner = { run: async (command, args) => {
        if (command !== "gh") return { stdout: "", stderr: "" };
        if (args[0] === "run" && args[1] === "list") { listCount += 1; return { stdout: JSON.stringify(listCount === 1 ? [] : [{ databaseId: 2, attempt: 1, event: "workflow_dispatch", headBranch: "codex/test", headSha: "a".repeat(40), url, status: "completed", conclusion: "success" }]), stderr: "" }; }
        if (args[0] === "run" && args[1] === "view") return { stdout: JSON.stringify({ databaseId: 2, attempt: 1, event: "workflow_dispatch", headBranch: "codex/test", headSha: "a".repeat(40), url, status: "completed", conclusion: "success" }), stderr: "" };
        return { stdout: "", stderr: "" };
      } };
      await expect(new GitHubCliProvider(runner, async () => undefined).dispatchAndVerify(target())).rejects.toThrow("DEVELOPMENT_INFRA_GITHUB_RUN_IDENTITY_CHANGED");
    }
  });
});
