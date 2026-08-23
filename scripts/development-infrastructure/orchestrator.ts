import type { DevelopmentInfrastructureConfig } from "./contracts";
import { deriveInfrastructureSecrets, infrastructureEnvironment, syntheticExternalIds, syntheticUsernames } from "./contracts";
import type { InfrastructureProviders } from "./providers";
import { createSourceFingerprint } from "../staging/source-fingerprint";
import { acceptanceOtherStudentDisplayName, acceptanceStudentDisplayName, acceptanceTeacherDisplayName } from "../staging/acceptance/contracts";

export type InfrastructureProgress = (code: string) => void;

const attestations = [
  "STAGING_SYNTHETIC_ONLY_ATTESTED",
  "STAGING_CLERK_INSTANCE_ATTESTED",
  "STAGING_DATABASE_ISOLATION_ATTESTED",
  "STAGING_HOSTING_ACCESS_ATTESTED",
  "STAGING_ROLLBACK_OWNER_ATTESTED",
  "STAGING_RETENTION_ATTESTED",
  "STAGING_ACCEPTANCE_WRITES_ATTESTED",
  "STAGING_ACCEPTANCE_CLERK_TOKENS_ATTESTED",
  "STAGING_ACCEPTANCE_RETENTION_ATTESTED",
] as const;

export type InfrastructureResult = Readonly<{ runUrl: string; environment: typeof infrastructureEnvironment }>;

/** Each phase returns before the next starts. This makes configuration failure fail closed. */
export async function reconcileDevelopmentInfrastructure(config: DevelopmentInfrastructureConfig, providers: InfrastructureProviders, progress: InfrastructureProgress = () => undefined): Promise<InfrastructureResult> {
  progress("DEVELOPMENT_INFRA_PHASE_GIT_TARGET");
  const repository = await providers.github.repositoryTarget();

  progress("DEVELOPMENT_INFRA_PHASE_READ_ONLY_IDENTITY");
  await providers.clerk.assertDevelopmentInstance();
  await providers.vercel.assertProject(repository);

  progress("DEVELOPMENT_INFRA_PHASE_CLERK");
  const [teacher, student, otherStudent] = await Promise.all([
    providers.clerk.ensureSyntheticIdentity(syntheticExternalIds.teacher, syntheticUsernames.teacher, "CDAS Staging Synthetic", "Teacher"),
    providers.clerk.ensureSyntheticIdentity(syntheticExternalIds.student, syntheticUsernames.student, "CDAS Staging Synthetic", "Student"),
    providers.clerk.ensureSyntheticIdentity(syntheticExternalIds.otherStudent, syntheticUsernames.otherStudent, "CDAS Staging Synthetic Other", "Student"),
  ]);
  if (new Set([teacher.id, student.id, otherStudent.id]).size !== 3) throw new Error("DEVELOPMENT_INFRA_CLERK_IDENTITIES_NOT_DISTINCT");

  progress("DEVELOPMENT_INFRA_PHASE_NEON");
  const connection = await providers.neon.ensureIsolatedDatabase();
  await providers.deployMigrations(connection);

  progress("DEVELOPMENT_INFRA_PHASE_VERCEL");
  const secrets = deriveInfrastructureSecrets(config.masterSecret);
  await providers.vercel.ensurePreviewEnvironment({
    DATABASE_URL: connection.pooledUrl,
    DIRECT_URL: connection.directUrl,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
    CLERK_SECRET_KEY: config.clerkSecretKey,
    AI_PROVIDER_DISABLED: "1",
    STAGING_HEALTH_PROOF_SECRET: secrets.healthProofSecret,
    NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "1",
  });
  await providers.vercel.ensureProtectionBypass(secrets.vercelBypassSecret);
  const deployment = await providers.vercel.deployPreview(repository);
  if (deployment.sha !== repository.sha) throw new Error("DEVELOPMENT_INFRA_VERCEL_SHA_MISMATCH");
  await providers.verifyApplication({ baseUrl: deployment.url, projectName: config.vercelProjectName, databaseUrl: connection.pooledUrl, clerkPublishableKey: config.clerkPublishableKey, clerkSecretKey: config.clerkSecretKey, healthProofSecret: secrets.healthProofSecret, bypassSecret: secrets.vercelBypassSecret, deploymentSha: repository.sha });

  progress("DEVELOPMENT_INFRA_PHASE_GITHUB_ENVIRONMENT");
  await providers.github.ensureEnvironment(repository);
  const variables: Record<string, string> = {
    STAGING_VERCEL_PROJECT_NAME: config.vercelProjectName,
    STAGING_DATABASE_NAME: config.neonDatabaseName,
    ...Object.fromEntries(attestations.map((name) => [name, "true"])),
  };
  for (const [name, value] of Object.entries(variables)) await providers.github.setVariable(name, value);
  const secretsForGitHub: Record<string, string> = {
    STAGING_BASE_URL: deployment.url,
    STAGING_DATABASE_URL: connection.pooledUrl,
    STAGING_DIRECT_URL: connection.directUrl,
    STAGING_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
    STAGING_CLERK_SECRET_KEY: config.clerkSecretKey,
    STAGING_TEST_TEACHER_CLERK_ID: teacher.id,
    STAGING_TEST_STUDENT_CLERK_ID: student.id,
    STAGING_TEST_OTHER_STUDENT_CLERK_ID: otherStudent.id,
    STAGING_HEALTH_PROOF_SECRET: secrets.healthProofSecret,
    STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: secrets.vercelBypassSecret,
  };
  for (const [name, value] of Object.entries(secretsForGitHub)) await providers.github.setSecret(name, value);

  progress("DEVELOPMENT_INFRA_PHASE_ACCEPTANCE");
  const run = await providers.github.dispatchAndVerify(repository);
  await providers.github.verifyDownloadedArtifact(run, { environment: {
    PATH: process.env.PATH ?? "",
    AI_PROVIDER_DISABLED: "1",
    STAGING_BASE_URL: deployment.url,
    STAGING_VERCEL_PROJECT_NAME: config.vercelProjectName,
    STAGING_DATABASE_NAME: config.neonDatabaseName,
    DATABASE_URL: connection.pooledUrl,
    DIRECT_URL: connection.directUrl,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
    CLERK_SECRET_KEY: config.clerkSecretKey,
    STAGING_TEST_TEACHER_CLERK_ID: teacher.id,
    STAGING_TEST_STUDENT_CLERK_ID: student.id,
    STAGING_TEST_OTHER_STUDENT_CLERK_ID: otherStudent.id,
    STAGING_HEALTH_PROOF_SECRET: secrets.healthProofSecret,
    STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: secrets.vercelBypassSecret,
    STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1",
    CDAS_DEPLOYMENT_ID: repository.sha,
    CDAS_SOURCE_FINGERPRINT: createSourceFingerprint(),
    GITHUB_RUN_ID: run.id,
    GITHUB_RUN_ATTEMPT: String(run.attempt),
    STAGING_ACCEPTANCE_TEST_TEACHER_NAME: acceptanceTeacherDisplayName,
    STAGING_ACCEPTANCE_TEST_STUDENT_NAME: acceptanceStudentDisplayName,
    STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME: acceptanceOtherStudentDisplayName,
    ...Object.fromEntries(attestations.map((name) => [name, "true"])),
  } });
  progress("DEVELOPMENT_INFRA_PASS");
  return { runUrl: run.url, environment: infrastructureEnvironment };
}
