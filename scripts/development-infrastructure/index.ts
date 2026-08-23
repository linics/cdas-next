
import { ClerkApiProvider, deployMigrationsWithMinimalEnvironment, SafeCommandRunner } from "./providers";
import { parseStagingEnvironmentFile, readValidatedStagingEnvironmentFile, stableInfrastructureErrorCode, validateConfig } from "./contracts";
import { reconcileDevelopmentInfrastructure } from "./orchestrator";
import { GitHubCliProvider, VercelApiProvider } from "./remote-providers";
import { NeonApiProvider } from "./providers";

async function main(): Promise<void> {
  const runner = new SafeCommandRunner();
  const source = await readValidatedStagingEnvironmentFile(process.cwd(), runner);
  const config = validateConfig(parseStagingEnvironmentFile(source));
  const github = new GitHubCliProvider(runner);
  const result = await reconcileDevelopmentInfrastructure(config, {
    clerk: new ClerkApiProvider(config.clerkSecretKey),
    neon: new NeonApiProvider(config),
    vercel: new VercelApiProvider(config.vercelToken, config.vercelProjectName, config.vercelTeamId),
    github,
    deployMigrations: (connection) => deployMigrationsWithMinimalEnvironment(connection, runner),
    verifyApplication: async (input) => {
      await runner.run("pnpm", ["staging:verify-application"], { env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", AI_PROVIDER_DISABLED: "1", CDAS_SKIP_LOCAL_ENV_CONFIG: "1", STAGING_BASE_URL: input.baseUrl, STAGING_VERCEL_PROJECT_NAME: input.projectName, DATABASE_URL: input.databaseUrl, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: input.clerkPublishableKey, CLERK_SECRET_KEY: input.clerkSecretKey, STAGING_HEALTH_PROOF_SECRET: input.healthProofSecret, STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: input.bypassSecret, STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1", CDAS_DEPLOYMENT_ID: input.deploymentSha } });
    },
  }, (code) => process.stdout.write(`${code}\n`));
  process.stdout.write(`DEVELOPMENT_INFRA_RUN ${result.runUrl}\nDEVELOPMENT_INFRA_PASS\n`);
}

void main().catch((error) => { process.stdout.write(`${stableInfrastructureErrorCode(error)}\n`); process.exitCode = 1; });
