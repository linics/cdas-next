import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  minimalCommandEnvironment,
  type CommandRunner,
} from "../development-infrastructure/providers";

export const agentModelCostAcknowledgement =
  "synthetic-data-cost-approved";

export function assertAgentAcceptanceArguments(args: readonly string[]): void {
  if (
    args.length !== 1 ||
    args[0] !==
      `--model-cost-approved=${agentModelCostAcknowledgement}`
  ) {
    throw new Error("DEVELOPMENT_AGENT_MODEL_COST_APPROVAL_REQUIRED");
  }
}

export function parseModelAcceptanceEnvironmentFile(source: string): string {
  const entries = source
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (entries.length !== 1) {
    throw new Error("DEVELOPMENT_AGENT_MODEL_CONFIG_INVALID");
  }
  const match = /^(?:export\s+)?DEEPSEEK_API_KEY=(.*)$/u.exec(entries[0] ?? "");
  if (!match) throw new Error("DEVELOPMENT_AGENT_MODEL_CONFIG_INVALID");
  let value = (match[1] ?? "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 16 || bytes > 4_096 || value.includes("\u0000")) {
    throw new Error("DEVELOPMENT_AGENT_MODEL_KEY_INVALID");
  }
  return value;
}

export async function readValidatedModelAcceptanceEnvironmentFile(
  repositoryRoot: string,
  runner: CommandRunner,
): Promise<string> {
  const root = path.resolve(repositoryRoot);
  const target = path.resolve(root, ".env.model-acceptance.local");
  if (path.dirname(target) !== root) {
    throw new Error("DEVELOPMENT_AGENT_MODEL_CONFIG_PATH_INVALID");
  }
  let status;
  try {
    status = await lstat(target);
  } catch {
    throw new Error("DEVELOPMENT_AGENT_MODEL_CONFIG_FILE_MISSING");
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error("DEVELOPMENT_AGENT_MODEL_CONFIG_FILE_UNSAFE");
  }
  if ((status.mode & 0o400) === 0 || (status.mode & 0o077) !== 0) {
    throw new Error("DEVELOPMENT_AGENT_MODEL_CONFIG_PERMISSIONS_UNSAFE");
  }
  try {
    await runner.run(
      "git",
      ["check-ignore", "--quiet", "--", ".env.model-acceptance.local"],
      { cwd: root, env: minimalCommandEnvironment() },
    );
  } catch {
    throw new Error("DEVELOPMENT_AGENT_MODEL_CONFIG_NOT_IGNORED");
  }
  try {
    return await readFile(target, "utf8");
  } catch {
    throw new Error("DEVELOPMENT_AGENT_MODEL_CONFIG_FILE_UNREADABLE");
  }
}

export function stableDevelopmentAgentError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "DEVELOPMENT_AGENT_ACCEPTANCE_FAILED";
  return /^DEVELOPMENT_(?:AGENT|INFRA)_[A-Z0-9_]{3,120}$/u.test(message)
    ? message
    : "DEVELOPMENT_AGENT_ACCEPTANCE_FAILED";
}
