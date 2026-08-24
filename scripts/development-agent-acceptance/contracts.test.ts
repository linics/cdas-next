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
});
