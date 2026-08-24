import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ClerkApiProvider,
  deployMigrationsWithMinimalEnvironment,
  minimalCommandEnvironment,
  NeonApiProvider,
  SafeCommandRunner,
  type CommandRunner,
  type NeonConnection,
  type RepositoryTarget,
  type WorkflowRun,
} from "../development-infrastructure/providers";
import {
  deriveInfrastructureSecrets,
  parseStagingEnvironmentFile,
  readValidatedStagingEnvironmentFile,
  syntheticExternalIds,
  syntheticUsernames,
  validateConfig,
  type DevelopmentInfrastructureConfig,
} from "../development-infrastructure/contracts";
import {
  GitHubCliProvider,
  VercelApiProvider,
} from "../development-infrastructure/remote-providers";
import {
  agentAcceptanceAttestations,
  agentAcceptanceStudentDisplayName,
  agentAcceptanceTeacherDisplayName,
} from "../staging/agent-acceptance/contracts";
import { createSourceFingerprint } from "../staging/source-fingerprint";
import {
  agentModelCostAcknowledgement,
  assertAgentAcceptanceArguments,
  parseModelAcceptanceEnvironmentFile,
  readValidatedModelAcceptanceEnvironmentFile,
  stableDevelopmentAgentError,
} from "./contracts";

const environmentName = "staging-agent-acceptance";
const workflowName = "staging-agent-acceptance.yml";
const model = "deepseek-v4-flash";

type AgentIdentity = Readonly<{ id: string }>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DEVELOPMENT_AGENT_PROVIDER_SCHEMA_INVALID");
  }
  return value as Record<string, unknown>;
}

class AgentGitHubOperator {
  constructor(
    private readonly runner: CommandRunner,
    private readonly sleep: (milliseconds: number) => Promise<void> =
      async (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  private gh(args: readonly string[], input?: string) {
    return this.runner.run("gh", args, {
      env: minimalCommandEnvironment({ github: true }),
      input,
    });
  }

  async ensureEnvironment(repository: RepositoryTarget): Promise<void> {
    const environmentPath = `repos/${repository.owner}/${repository.name}/environments/${environmentName}`;
    await this.gh(
      ["api", "--method", "PUT", environmentPath, "--input", "-"],
      JSON.stringify({
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      }),
    );
    const listPolicies = async () => {
      const pages = JSON.parse(
        (
          await this.gh([
            "api",
            `${environmentPath}/deployment-branch-policies`,
            "--paginate",
            "--slurp",
          ])
        ).stdout,
      ) as unknown;
      if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error("DEVELOPMENT_AGENT_GITHUB_POLICY_SCHEMA_INVALID");
      }
      return pages.flatMap((page) => {
        const policies = object(page).branch_policies;
        if (!Array.isArray(policies)) {
          throw new Error("DEVELOPMENT_AGENT_GITHUB_POLICY_SCHEMA_INVALID");
        }
        return policies.map(object);
      });
    };
    const initial = await listPolicies();
    for (const policy of initial) {
      if (policy.name === repository.branch) continue;
      if (policy.name !== "codex/*") {
        throw new Error("DEVELOPMENT_AGENT_GITHUB_POLICY_UNSAFE");
      }
      const id = String(policy.id ?? "");
      if (!/^\d+$/u.test(id)) {
        throw new Error("DEVELOPMENT_AGENT_GITHUB_POLICY_SCHEMA_INVALID");
      }
      await this.gh([
        "api",
        "--method",
        "DELETE",
        `${environmentPath}/deployment-branch-policies/${id}`,
      ]);
    }
    const afterDelete = await listPolicies();
    if (afterDelete.some((policy) => policy.name !== repository.branch)) {
      throw new Error("DEVELOPMENT_AGENT_GITHUB_POLICY_UNSAFE");
    }
    if (afterDelete.length === 0) {
      await this.gh(
        [
          "api",
          "--method",
          "POST",
          `${environmentPath}/deployment-branch-policies`,
          "--input",
          "-",
        ],
        JSON.stringify({ name: repository.branch }),
      );
    }
    const final = await listPolicies();
    if (
      final.length !== 1 ||
      final[0]?.name !== repository.branch ||
      !/^(?:\d+|[A-Za-z0-9_-]+)$/u.test(String(final[0]?.id ?? ""))
    ) {
      throw new Error("DEVELOPMENT_AGENT_GITHUB_POLICY_UNSAFE");
    }
  }

  async assertCiPassed(repository: RepositoryTarget): Promise<void> {
    const listed = JSON.parse(
      (
        await this.gh([
          "run",
          "list",
          "--workflow",
          "ci.yml",
          "--branch",
          repository.branch,
          "--limit",
          "100",
          "--json",
          "databaseId,headBranch,headSha,status,conclusion,url",
        ])
      ).stdout,
    ) as unknown;
    if (!Array.isArray(listed)) {
      throw new Error("DEVELOPMENT_AGENT_GITHUB_CI_SCHEMA_INVALID");
    }
    const matches = listed
      .map(object)
      .filter(
        (entry) =>
          entry.headBranch === repository.branch &&
          entry.headSha === repository.sha,
      );
    if (matches.length !== 1) {
      throw new Error("DEVELOPMENT_AGENT_GITHUB_CI_NOT_BOUND");
    }
    const run = matches[0];
    const id = String(run?.databaseId ?? "");
    if (
      !/^\d+$/u.test(id) ||
      run?.status !== "completed" ||
      run.conclusion !== "success" ||
      run.url !==
        `https://github.com/${repository.owner}/${repository.name}/actions/runs/${id}`
    ) {
      throw new Error("DEVELOPMENT_AGENT_GITHUB_CI_NOT_PASSED");
    }
  }

  async setVariable(name: string, value: string): Promise<void> {
    await this.gh([
      "variable",
      "set",
      name,
      "--env",
      environmentName,
      "--body",
      value,
    ]);
  }

  async setSecret(name: string, value: string): Promise<void> {
    await this.gh(["secret", "set", name, "--env", environmentName], value);
  }

  async deleteSecret(name: string): Promise<void> {
    await this.gh(["secret", "delete", name, "--env", environmentName]);
  }

  async assertPaidConfigurationClosed(): Promise<void> {
    const variables = JSON.parse(
      (
        await this.gh([
          "variable",
          "list",
          "--env",
          environmentName,
          "--json",
          "name,value",
        ])
      ).stdout,
    ) as unknown;
    const secrets = JSON.parse(
      (
        await this.gh([
          "secret",
          "list",
          "--env",
          environmentName,
          "--json",
          "name",
        ])
      ).stdout,
    ) as unknown;
    if (!Array.isArray(variables) || !Array.isArray(secrets)) {
      throw new Error("DEVELOPMENT_AGENT_GITHUB_CLEANUP_SCHEMA_INVALID");
    }
    const costClosed = variables
      .map(object)
      .some(
        (entry) =>
          entry.name === "STAGING_AGENT_MODEL_COST_ATTESTED" &&
          entry.value === "false",
      );
    const paidSecrets = new Set([
      "STAGING_DEEPSEEK_API_KEY",
      "STAGING_AI_TOOL_APPROVAL_SECRET",
    ]);
    if (
      !costClosed ||
      secrets.map(object).some((entry) => paidSecrets.has(String(entry.name)))
    ) {
      throw new Error("DEVELOPMENT_AGENT_GITHUB_PAID_CONFIG_NOT_CLOSED");
    }
  }

  async dispatch(repository: RepositoryTarget): Promise<WorkflowRun> {
    const before = JSON.parse(
      (
        await this.gh([
          "run",
          "list",
          "--workflow",
          workflowName,
          "--branch",
          repository.branch,
          "--limit",
          "100",
          "--json",
          "databaseId",
        ])
      ).stdout,
    ) as unknown;
    if (!Array.isArray(before)) {
      throw new Error("DEVELOPMENT_AGENT_GITHUB_RUN_SCHEMA_INVALID");
    }
    const watermark = new Set(
      before.map(object).map((entry) => String(entry.databaseId)),
    );
    await this.gh([
      "workflow",
      "run",
      workflowName,
      "--ref",
      repository.branch,
      "-f",
      "run_real_model=true",
    ]);
    process.stdout.write("DEVELOPMENT_AGENT_DISPATCHED\n");

    let runId = "";
    for (let attempt = 0; attempt < 30 && !runId; attempt += 1) {
      await this.sleep(5_000);
      const listed = JSON.parse(
        (
          await this.gh([
            "run",
            "list",
            "--workflow",
            workflowName,
            "--branch",
            repository.branch,
            "--limit",
            "100",
            "--json",
            "databaseId,event,headBranch,headSha",
          ])
        ).stdout,
      ) as unknown;
      if (!Array.isArray(listed)) {
        throw new Error("DEVELOPMENT_AGENT_GITHUB_RUN_SCHEMA_INVALID");
      }
      const matches = listed
        .map(object)
        .filter(
          (entry) =>
            !watermark.has(String(entry.databaseId)) &&
            entry.event === "workflow_dispatch" &&
            entry.headBranch === repository.branch &&
            entry.headSha === repository.sha,
        );
      if (matches.length > 1) {
        throw new Error("DEVELOPMENT_AGENT_GITHUB_RUN_AMBIGUOUS");
      }
      if (matches[0]) runId = String(matches[0].databaseId);
    }
    if (!/^\d+$/u.test(runId)) {
      throw new Error("DEVELOPMENT_AGENT_GITHUB_RUN_NOT_FOUND");
    }
    const expectedUrl = `https://github.com/${repository.owner}/${repository.name}/actions/runs/${runId}`;
    process.stdout.write(`DEVELOPMENT_AGENT_RUN ${expectedUrl}\n`);

    let lastState = "";
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const view = object(
        JSON.parse(
          (
            await this.gh([
              "run",
              "view",
              runId,
              "--json",
              "databaseId,attempt,event,headBranch,headSha,url,status,conclusion",
            ])
          ).stdout,
        ),
      );
      if (
        String(view.databaseId) !== runId ||
        view.event !== "workflow_dispatch" ||
        view.headBranch !== repository.branch ||
        view.headSha !== repository.sha ||
        view.url !== expectedUrl
      ) {
        throw new Error("DEVELOPMENT_AGENT_GITHUB_RUN_IDENTITY_CHANGED");
      }
      const state = `${String(view.status)}:${String(view.conclusion ?? "")}`;
      if (state !== lastState) {
        process.stdout.write(`DEVELOPMENT_AGENT_RUN_STATE ${state}\n`);
        lastState = state;
      }
      if (view.status === "completed") {
        if (view.conclusion !== "success") {
          throw new Error("DEVELOPMENT_AGENT_REMOTE_RUN_FAILED");
        }
        const runAttempt = Number(view.attempt);
        if (!Number.isInteger(runAttempt) || runAttempt < 1) {
          throw new Error("DEVELOPMENT_AGENT_GITHUB_RUN_SCHEMA_INVALID");
        }
        return {
          id: runId,
          attempt: runAttempt,
          url: expectedUrl,
          headSha: repository.sha,
        };
      }
      if (attempt === 179) {
        throw new Error("DEVELOPMENT_AGENT_GITHUB_RUN_TIMEOUT");
      }
      await this.sleep(15_000);
    }
    throw new Error("DEVELOPMENT_AGENT_GITHUB_RUN_TIMEOUT");
  }

  async verifyArtifact(
    run: WorkflowRun,
    environment: Readonly<Record<string, string>>,
  ): Promise<void> {
    const directory = await mkdtemp(
      path.join(tmpdir(), "cdas-development-agent-"),
    );
    try {
      const output = path.join(
        directory,
        "output",
        "staging-agent-acceptance",
      );
      await mkdir(output, { recursive: true });
      await this.gh([
        "run",
        "download",
        run.id,
        "--name",
        `staging-agent-acceptance-${run.id}-${run.attempt}`,
        "--dir",
        output,
      ]);
      await this.runner.run(
        "node",
        [
          "--import",
          "tsx",
          path.join(
            process.cwd(),
            "scripts",
            "staging",
            "agent-acceptance",
            "assert-final.ts",
          ),
        ],
        {
          cwd: directory,
          env: { ...minimalCommandEnvironment(), ...environment },
        },
      );
    } catch {
      throw new Error("DEVELOPMENT_AGENT_ARTIFACT_INVALID");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function verifyApplication(
  runner: SafeCommandRunner,
  input: Readonly<{
    marker: string;
    baseUrl: string;
    repository: RepositoryTarget;
    config: DevelopmentInfrastructureConfig;
    connection: NeonConnection;
    healthProofSecret: string;
    bypassSecret: string;
    aiProviderDisabled: "0" | "1";
    modelKey?: string;
    approvalSecret?: string;
  }>,
): Promise<void> {
  await runner.run("pnpm", ["staging:verify-application"], {
    env: {
      ...minimalCommandEnvironment(),
      NODE_ENV: "production",
      CDAS_SKIP_LOCAL_ENV_CONFIG: "1",
      STAGING_RUN_MARKER: input.marker,
      STAGING_BASE_URL: input.baseUrl,
      STAGING_VERCEL_PROJECT_NAME: input.config.vercelProjectName,
      STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1",
      STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: input.bypassSecret,
      DATABASE_URL: input.connection.pooledUrl,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: input.config.clerkPublishableKey,
      CLERK_SECRET_KEY: input.config.clerkSecretKey,
      AI_PROVIDER_DISABLED: input.aiProviderDisabled,
      ...(input.modelKey ? { DEEPSEEK_API_KEY: input.modelKey } : {}),
      ...(input.aiProviderDisabled === "0" ? { AI_MODEL: model } : {}),
      ...(input.approvalSecret
        ? { AI_TOOL_APPROVAL_SECRET: input.approvalSecret }
        : {}),
      STAGING_HEALTH_PROOF_SECRET: input.healthProofSecret,
      CDAS_DEPLOYMENT_ID: input.repository.sha,
    },
  });
}

function artifactEnvironment(input: Readonly<{
  repository: RepositoryTarget;
  run: WorkflowRun;
  config: DevelopmentInfrastructureConfig;
  connection: NeonConnection;
  teacher: AgentIdentity;
  student: AgentIdentity;
  baseUrl: string;
  modelKey: string;
  approvalSecret: string;
  healthProofSecret: string;
  bypassSecret: string;
}>): Readonly<Record<string, string>> {
  return {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "production",
    STAGING_DATA_ACK: "synthetic-data-only-approved",
    STAGING_RUN_MARKER: `cdas-staging-agent-${input.run.id}-${input.run.attempt}`,
    GITHUB_RUN_ID: input.run.id,
    GITHUB_RUN_ATTEMPT: String(input.run.attempt),
    CDAS_DEPLOYMENT_ID: input.repository.sha,
    CDAS_SOURCE_FINGERPRINT: createSourceFingerprint(),
    STAGING_BASE_URL: input.baseUrl,
    STAGING_VERCEL_PROJECT_NAME: input.config.vercelProjectName,
    STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1",
    STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: input.bypassSecret,
    STAGING_DATABASE_NAME: input.config.neonDatabaseName,
    DATABASE_URL: input.connection.pooledUrl,
    DIRECT_URL: input.connection.directUrl,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: input.config.clerkPublishableKey,
    CLERK_SECRET_KEY: input.config.clerkSecretKey,
    STAGING_TEST_TEACHER_CLERK_ID: input.teacher.id,
    STAGING_TEST_STUDENT_CLERK_ID: input.student.id,
    STAGING_ACCEPTANCE_TEST_TEACHER_NAME:
      agentAcceptanceTeacherDisplayName,
    STAGING_ACCEPTANCE_TEST_STUDENT_NAME:
      agentAcceptanceStudentDisplayName,
    AI_PROVIDER_DISABLED: "0",
    STAGING_AI_ACK: agentModelCostAcknowledgement,
    DEEPSEEK_API_KEY: input.modelKey,
    AI_MODEL: model,
    AI_TOOL_APPROVAL_SECRET: input.approvalSecret,
    STAGING_HEALTH_PROOF_SECRET: input.healthProofSecret,
    ...Object.fromEntries(
      agentAcceptanceAttestations.map((name) => [name, "true"]),
    ),
  };
}

async function configureAgentEnvironment(
  github: AgentGitHubOperator,
  input: Readonly<{
    config: DevelopmentInfrastructureConfig;
    repository: RepositoryTarget;
    connection: NeonConnection;
    teacher: AgentIdentity;
    student: AgentIdentity;
    baseUrl: string;
    modelKey: string;
    approvalSecret: string;
    healthProofSecret: string;
    bypassSecret: string;
  }>,
): Promise<void> {
  await github.ensureEnvironment(input.repository);
  const variables = {
    STAGING_BASE_URL: input.baseUrl,
    STAGING_VERCEL_PROJECT_NAME: input.config.vercelProjectName,
    STAGING_DATABASE_NAME: input.config.neonDatabaseName,
    STAGING_AI_MODEL: model,
    STAGING_SYNTHETIC_ONLY_ATTESTED: "true",
    STAGING_CLERK_INSTANCE_ATTESTED: "true",
    STAGING_DATABASE_ISOLATION_ATTESTED: "true",
    STAGING_HOSTING_ACCESS_ATTESTED: "true",
    STAGING_ROLLBACK_OWNER_ATTESTED: "true",
    STAGING_RETENTION_ATTESTED: "true",
    STAGING_AGENT_WRITES_ATTESTED: "true",
    STAGING_AGENT_CLERK_TOKENS_ATTESTED: "true",
    STAGING_AGENT_RETENTION_ATTESTED: "true",
    STAGING_AGENT_IDENTITIES_RESERVED_ATTESTED: "true",
  };
  for (const [name, value] of Object.entries(variables)) {
    await github.setVariable(name, value);
  }
  const secrets = {
    STAGING_DATABASE_URL: input.connection.pooledUrl,
    STAGING_DIRECT_URL: input.connection.directUrl,
    STAGING_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      input.config.clerkPublishableKey,
    STAGING_CLERK_SECRET_KEY: input.config.clerkSecretKey,
    STAGING_TEST_TEACHER_CLERK_ID: input.teacher.id,
    STAGING_TEST_STUDENT_CLERK_ID: input.student.id,
    STAGING_HEALTH_PROOF_SECRET: input.healthProofSecret,
    STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: input.bypassSecret,
    STAGING_DEEPSEEK_API_KEY: input.modelKey,
    STAGING_AI_TOOL_APPROVAL_SECRET: input.approvalSecret,
  };
  for (const [name, value] of Object.entries(secrets)) {
    await github.setSecret(name, value);
  }
  // The paid gate is deliberately last: all non-metered checks and bindings
  // are complete before this variable can permit a real-model run.
  await github.setVariable("STAGING_AGENT_MODEL_COST_ATTESTED", "true");
}

async function main(): Promise<void> {
  assertAgentAcceptanceArguments(process.argv.slice(2));
  const runner = new SafeCommandRunner();
  const config = validateConfig(
    parseStagingEnvironmentFile(
      await readValidatedStagingEnvironmentFile(process.cwd(), runner),
    ),
  );
  const modelKey = parseModelAcceptanceEnvironmentFile(
    await readValidatedModelAcceptanceEnvironmentFile(process.cwd(), runner),
  );
  const approvalSecret = randomBytes(48).toString("base64url");
  const repository = await new GitHubCliProvider(runner).repositoryTarget();
  const github = new AgentGitHubOperator(runner);
  const vercel = new VercelApiProvider(
    config.vercelToken,
    config.vercelProjectName,
    config.vercelTeamId,
  );
  const clerk = new ClerkApiProvider(config.clerkSecretKey);
  const neon = new NeonApiProvider(config);
  const derived = deriveInfrastructureSecrets(config.masterSecret);
  let failure: string | null = null;
  let cleanupFailure: string | null = null;
  let connection: NeonConnection | null = null;
  let runUrl = "";

  try {
    process.stdout.write("DEVELOPMENT_AGENT_PHASE_READ_ONLY_BOUNDARIES\n");
    await github.assertCiPassed(repository);
    await Promise.all([
      clerk.assertDevelopmentInstance(),
      (async () => {
        await vercel.assertProject(repository);
        await vercel.assertPrivateBlobConnection();
      })(),
    ]);
    connection = await neon.ensureIsolatedDatabase();
    await deployMigrationsWithMinimalEnvironment(connection, runner);
    const [teacher, student] = await Promise.all([
      clerk.ensureSyntheticIdentity(
        syntheticExternalIds.teacher,
        syntheticUsernames.teacher,
        "CDAS Staging Synthetic",
        "Teacher",
      ),
      clerk.ensureSyntheticIdentity(
        syntheticExternalIds.student,
        syntheticUsernames.student,
        "CDAS Staging Synthetic",
        "Student",
      ),
    ]);
    if (teacher.id === student.id) {
      throw new Error("DEVELOPMENT_AGENT_IDENTITIES_NOT_DISTINCT");
    }

    process.stdout.write("DEVELOPMENT_AGENT_PHASE_AI_PREVIEW\n");
    await vercel.ensurePreviewEnvironment({
      DATABASE_URL: connection.pooledUrl,
      DIRECT_URL: connection.directUrl,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
      CLERK_SECRET_KEY: config.clerkSecretKey,
      AI_PROVIDER_DISABLED: "0",
      DEEPSEEK_API_KEY: modelKey,
      AI_MODEL: model,
      AI_TOOL_APPROVAL_SECRET: approvalSecret,
      ATTACHMENT_STORAGE_ENABLED: "1",
      STAGING_HEALTH_PROOF_SECRET: derived.healthProofSecret,
      NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "1",
    });
    await vercel.ensureProtectionBypass(derived.vercelBypassSecret);
    const deployment = await vercel.deployPreview(repository);
    await verifyApplication(runner, {
      marker: `cdas-staging-agent-preflight-${repository.sha.slice(0, 12)}`,
      baseUrl: deployment.url,
      repository,
      config,
      connection,
      healthProofSecret: derived.healthProofSecret,
      bypassSecret: derived.vercelBypassSecret,
      aiProviderDisabled: "0",
      modelKey,
      approvalSecret,
    });
    process.stdout.write(`DEVELOPMENT_AGENT_AI_PREVIEW ${deployment.url}\n`);

    process.stdout.write("DEVELOPMENT_AGENT_PHASE_PROTECTED_BINDING\n");
    await configureAgentEnvironment(github, {
      config,
      repository,
      connection,
      teacher,
      student,
      baseUrl: deployment.url,
      modelKey,
      approvalSecret,
      healthProofSecret: derived.healthProofSecret,
      bypassSecret: derived.vercelBypassSecret,
    });
    const run = await github.dispatch(repository);
    runUrl = run.url;
    await github.verifyArtifact(
      run,
      artifactEnvironment({
        repository,
        run,
        config,
        connection,
        teacher,
        student,
        baseUrl: deployment.url,
        modelKey,
        approvalSecret,
        healthProofSecret: derived.healthProofSecret,
        bypassSecret: derived.vercelBypassSecret,
      }),
    );
    process.stdout.write("DEVELOPMENT_AGENT_ARTIFACT_PASS\n");
  } catch (error) {
    failure = stableDevelopmentAgentError(error);
    process.stdout.write(`DEVELOPMENT_AGENT_RESULT ${failure}\n`);
  } finally {
    process.stdout.write("DEVELOPMENT_AGENT_PHASE_CLOSE_PAID_WINDOW\n");
    const cleanupErrors: unknown[] = [];
    const cleanup = async (operation: () => Promise<void>) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    await cleanup(async () => {
      await github.setVariable(
        "STAGING_AGENT_MODEL_COST_ATTESTED",
        "false",
      );
    });
    await github.deleteSecret("STAGING_DEEPSEEK_API_KEY").catch(() => undefined);
    await github
      .deleteSecret("STAGING_AI_TOOL_APPROVAL_SECRET")
      .catch(() => undefined);
    await cleanup(async () => {
      await github.assertPaidConfigurationClosed();
    });
    let disabledUrl = "";
    await cleanup(async () => {
      await vercel.assertProject(repository);
      await vercel.assertPrivateBlobConnection();
      await vercel.ensurePreviewEnvironment({ AI_PROVIDER_DISABLED: "1" });
      await vercel.removePaidPreviewEnvironment();
      const disabled = await vercel.deployPreview(repository);
      disabledUrl = disabled.url;
      if (connection) {
        await verifyApplication(runner, {
          marker: `cdas-staging-agent-cleanup-${repository.sha.slice(0, 12)}`,
          baseUrl: disabled.url,
          repository,
          config,
          connection,
          healthProofSecret: derived.healthProofSecret,
          bypassSecret: derived.vercelBypassSecret,
          aiProviderDisabled: "1",
        });
      }
      process.stdout.write(
        `DEVELOPMENT_AGENT_AI_DISABLED_PREVIEW ${disabled.url}\n`,
      );
    });
    if (disabledUrl) {
      await cleanup(async () => {
        await github.setVariable("STAGING_BASE_URL", disabledUrl);
      });
    }
    if (cleanupErrors.length > 0) {
      cleanupFailure = stableDevelopmentAgentError(cleanupErrors[0]);
      process.stdout.write(
        `DEVELOPMENT_AGENT_CLEANUP ${cleanupFailure}\n`,
      );
    }
  }

  if (failure || cleanupFailure) {
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`DEVELOPMENT_AGENT_PASS ${runUrl}\n`);
}

void main().catch((error) => {
  process.stdout.write(`${stableDevelopmentAgentError(error)}\n`);
  process.exitCode = 1;
});
