import { readFileSync } from "node:fs";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  agentModelCostAcknowledgement,
  assertAgentAcceptanceArguments,
  parseModelAcceptanceEnvironmentFile,
  readValidatedModelAcceptanceEnvironmentFile,
  stableDevelopmentAgentError,
} from "./contracts";
import { AgentGitHubOperator } from "./index";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(mode = 0o600): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "cdas-agent-config-"));
  directories.push(directory);
  const file = path.join(directory, ".env.model-acceptance.local");
  await writeFile(file, `DEEPSEEK_API_KEY=${"k".repeat(24)}\n`, { mode });
  await chmod(file, mode);
  return directory;
}

const ignoredRunner = { run: async () => ({ stdout: "", stderr: "" }) };

describe("development Agent acceptance contracts", () => {
  it("requires the one exact model-cost acknowledgement", () => {
    expect(() =>
      assertAgentAcceptanceArguments([
        `--model-cost-approved=${agentModelCostAcknowledgement}`,
      ]),
    ).not.toThrow();
    for (const args of [
      [],
      ["--model-cost-approved=true"],
      [
        `--model-cost-approved=${agentModelCostAcknowledgement}`,
        "--extra",
      ],
    ]) {
      expect(() => assertAgentAcceptanceArguments(args)).toThrow(
        "DEVELOPMENT_AGENT_MODEL_COST_APPROVAL_REQUIRED",
      );
    }
  });

  it("parses only one bounded DeepSeek key without returning its name", () => {
    expect(
      parseModelAcceptanceEnvironmentFile(
        `export DEEPSEEK_API_KEY='${"x".repeat(24)}'\n`,
      ),
    ).toBe("x".repeat(24));
    expect(() =>
      parseModelAcceptanceEnvironmentFile("DEEPSEEK_API_KEY=short"),
    ).toThrow("DEVELOPMENT_AGENT_MODEL_KEY_INVALID");
    expect(() =>
      parseModelAcceptanceEnvironmentFile(
        `DEEPSEEK_API_KEY=${"x".repeat(24)}\nOTHER=value`,
      ),
    ).toThrow("DEVELOPMENT_AGENT_MODEL_CONFIG_INVALID");
  });

  it("reads only the ignored root regular 0600 model file", async () => {
    const directory = await fixture();
    await expect(
      readValidatedModelAcceptanceEnvironmentFile(directory, ignoredRunner),
    ).resolves.toContain("DEEPSEEK_API_KEY");

    const loose = await fixture(0o644);
    await expect(
      readValidatedModelAcceptanceEnvironmentFile(loose, ignoredRunner),
    ).rejects.toThrow("DEVELOPMENT_AGENT_MODEL_CONFIG_PERMISSIONS_UNSAFE");

    const linked = await fixture();
    const target = path.join(linked, ".env.model-acceptance.local");
    const real = path.join(linked, "real-key");
    await writeFile(real, `DEEPSEEK_API_KEY=${"k".repeat(24)}\n`, {
      mode: 0o600,
    });
    await rm(target);
    await symlink("real-key", target);
    await expect(
      readValidatedModelAcceptanceEnvironmentFile(linked, ignoredRunner),
    ).rejects.toThrow("DEVELOPMENT_AGENT_MODEL_CONFIG_FILE_UNSAFE");

    const notIgnored = await fixture();
    await expect(
      readValidatedModelAcceptanceEnvironmentFile(notIgnored, {
        run: async () => {
          throw new Error("not ignored");
        },
      }),
    ).rejects.toThrow("DEVELOPMENT_AGENT_MODEL_CONFIG_NOT_IGNORED");
  });

  it("never returns arbitrary provider text as a stable error", () => {
    expect(
      stableDevelopmentAgentError(
        new Error("DEVELOPMENT_AGENT_REMOTE_RUN_FAILED"),
      ),
    ).toBe("DEVELOPMENT_AGENT_REMOTE_RUN_FAILED");
    expect(
      stableDevelopmentAgentError(new Error("Bearer leaked-provider-detail")),
    ).toBe("DEVELOPMENT_AGENT_ACCEPTANCE_FAILED");
  });

  it("keeps cost opening last and cleanup fail-independent", () => {
    const source = readFileSync(
      "scripts/development-agent-acceptance/index.ts",
      "utf8",
    );
    const main = source.slice(source.indexOf("async function main"));
    expect(main.indexOf("assertAgentAcceptanceArguments")).toBeLessThan(
      main.indexOf("readValidatedStagingEnvironmentFile"),
    );
    const configure = source.slice(
      source.indexOf("async function configureAgentEnvironment"),
      source.indexOf("async function main"),
    );
    expect(configure.indexOf("STAGING_DEEPSEEK_API_KEY")).toBeLessThan(
      configure.indexOf('STAGING_AGENT_MODEL_COST_ATTESTED", "true"'),
    );
    const closing = main.slice(
      main.indexOf("DEVELOPMENT_AGENT_PHASE_CLOSE_PAID_WINDOW"),
    );
    expect(closing.indexOf('STAGING_AGENT_MODEL_COST_ATTESTED"')).toBeLessThan(
      closing.indexOf("removePaidPreviewEnvironment"),
    );
    expect(closing).toContain("const cleanupErrors: unknown[] = []");
    expect(source).not.toContain("console.log(modelKey)");
    expect(source).not.toContain("console.log(approvalSecret)");
  });

  it("uses an absolute tsx loader when verifying artifacts from a temporary cwd", () => {
    const source = readFileSync(
      "scripts/development-agent-acceptance/index.ts",
      "utf8",
    );
    const verifyArtifact = source.slice(
      source.indexOf("async verifyArtifact"),
      source.indexOf("async function verifyApplication"),
    );

    expect(verifyArtifact).toContain(
      'const tsxLoader = import.meta.resolve("tsx");',
    );
    expect(verifyArtifact).toContain('"--import",\n          tsxLoader');
    expect(verifyArtifact).not.toContain('"--import",\n          "tsx"');
  });

  it("rejects names outside the exact Agent environment allowlists", async () => {
    const calls: string[][] = [];
    const runner = {
      run: async (_command: string, args: readonly string[]) => {
        calls.push([...args]);
        return { stdout: "", stderr: "" };
      },
    };
    const operator = new AgentGitHubOperator(runner, async () => undefined);
    await expect(operator.setVariable("UNEXPECTED", "value")).rejects.toThrow(
      "DEVELOPMENT_AGENT_GITHUB_VARIABLE_UNSAFE",
    );
    await expect(operator.setSecret("UNEXPECTED", "value")).rejects.toThrow(
      "DEVELOPMENT_AGENT_GITHUB_SECRET_UNSAFE",
    );
    await expect(operator.deleteSecret("UNEXPECTED")).rejects.toThrow(
      "DEVELOPMENT_AGENT_GITHUB_SECRET_DELETE_UNSAFE",
    );
    await expect(operator.deleteVariable("UNEXPECTED")).rejects.toThrow(
      "DEVELOPMENT_AGENT_GITHUB_VARIABLE_DELETE_UNSAFE",
    );
    expect(calls).toEqual([]);
  });

  it("deletes only exact retired entries and proves they are absent", async () => {
    const legacyVariable = "STAGING_CLERK_INSTANCE_ATTESTED";
    const legacySecret = "STAGING_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY";
    const variables = new Set([legacyVariable, `${legacyVariable}_COPY`]);
    const secrets = new Set([legacySecret, `${legacySecret}_COPY`]);
    const runner = {
      run: async (_command: string, args: readonly string[]) => {
        if (args[0] === "variable" && args[1] === "list") {
          return {
            stdout: JSON.stringify(
              [...variables].map((name) => ({ name, value: "true" })),
            ),
            stderr: "",
          };
        }
        if (args[0] === "secret" && args[1] === "list") {
          return {
            stdout: JSON.stringify([...secrets].map((name) => ({ name }))),
            stderr: "",
          };
        }
        if (args[0] === "variable" && args[1] === "delete") {
          variables.delete(args[2] ?? "");
        }
        if (args[0] === "secret" && args[1] === "delete") {
          secrets.delete(args[2] ?? "");
        }
        return { stdout: "", stderr: "" };
      },
    };
    const operator = new AgentGitHubOperator(runner, async () => undefined);
    await operator.deleteLegacyConfiguration();
    expect(variables).toEqual(new Set([`${legacyVariable}_COPY`]));
    expect(secrets).toEqual(new Set([`${legacySecret}_COPY`]));
  });

  it("closes paid secrets idempotently when none or only one remains", async () => {
    for (const initial of [[], ["STAGING_DEEPSEEK_API_KEY"]]) {
      const secrets = new Set(initial);
      const deleted: string[] = [];
      let listCount = 0;
      const runner = {
        run: async (_command: string, args: readonly string[]) => {
          if (args[0] === "secret" && args[1] === "list") {
            listCount += 1;
            return {
              stdout: JSON.stringify([...secrets].map((name) => ({ name }))),
              stderr: "",
            };
          }
          if (args[0] === "secret" && args[1] === "delete") {
            const name = args[2] ?? "";
            deleted.push(name);
            secrets.delete(name);
          }
          return { stdout: "", stderr: "" };
        },
      };
      const operator = new AgentGitHubOperator(runner, async () => undefined);
      await expect(operator.deletePaidSecrets()).resolves.toBeUndefined();
      expect(deleted).toEqual(initial);
      expect(secrets.size).toBe(0);
      expect(listCount).toBe(2);
    }
  });

  it("generates one password map for secret configuration and local artifact verification", () => {
    const source = readFileSync(
      "scripts/development-agent-acceptance/index.ts",
      "utf8",
    );
    expect(source).toContain("const passwords = generateSyntheticPasswords()");
    expect(source).toContain("...input.passwords");
    expect(source).not.toContain("JSON.stringify(passwords)");
    expect(source).not.toContain("console.log(passwords)");
  });

  it("binds the artifact environment to the local-auth workflow contract", () => {
    const source = readFileSync(
      "scripts/development-agent-acceptance/index.ts",
      "utf8",
    );
    expect(source).toContain('STAGING_AUTH_MODE: "postgres-local-v1"');
    for (const name of [
      "STAGING_LOCAL_AUTH_ATTESTED",
      "STAGING_AGENT_LOCAL_SESSIONS_ATTESTED",
      "STAGING_TEST_PRIMARY_SCHOOL_CODE",
      "STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO",
      "syntheticPasswordNames",
    ]) {
      expect(source).toContain(name);
    }
  });
});
