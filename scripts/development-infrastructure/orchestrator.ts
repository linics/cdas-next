import type { DevelopmentInfrastructureConfig } from "./contracts";
import {
  deriveInfrastructureSecrets,
  generateSyntheticPasswords,
  infrastructureEnvironment,
  syntheticFixtures,
} from "./contracts";
import type { InfrastructureProviders } from "./providers";
import { createSourceFingerprint } from "../staging/source-fingerprint";
import { acceptanceOtherStudentDisplayName, acceptanceOtherTeacherDisplayName, acceptanceStudentDisplayName, acceptanceTeacherDisplayName } from "../staging/acceptance/contracts";

export type InfrastructureProgress = (code: string) => void;

const attestations = [
  "STAGING_SYNTHETIC_ONLY_ATTESTED",
  "STAGING_LOCAL_AUTH_ATTESTED",
  "STAGING_DATABASE_ISOLATION_ATTESTED",
  "STAGING_HOSTING_ACCESS_ATTESTED",
  "STAGING_ROLLBACK_OWNER_ATTESTED",
  "STAGING_RETENTION_ATTESTED",
  "STAGING_ACCEPTANCE_WRITES_ATTESTED",
  "STAGING_ACCEPTANCE_LOCAL_AUTH_ATTESTED",
  "STAGING_ACCEPTANCE_RETENTION_ATTESTED",
] as const;

export type InfrastructureResult = Readonly<{ runUrl: string; environment: typeof infrastructureEnvironment }>;

/** Each phase returns before the next starts. This makes configuration failure fail closed. */
export async function reconcileDevelopmentInfrastructure(config: DevelopmentInfrastructureConfig, providers: InfrastructureProviders, progress: InfrastructureProgress = () => undefined): Promise<InfrastructureResult> {
  progress("DEVELOPMENT_INFRA_PHASE_GIT_TARGET");
  const repository = await providers.github.repositoryTarget();

  progress("DEVELOPMENT_INFRA_PHASE_READ_ONLY_IDENTITY");
  progress("DEVELOPMENT_INFRA_PHASE_READ_ONLY_BOUNDARIES");
  await providers.vercel.assertProject(repository);
  await providers.vercel.assertPrivateBlobConnection();

  progress("DEVELOPMENT_INFRA_PHASE_NEON");
  const connection = await providers.neon.ensureIsolatedDatabase();
  await providers.deployMigrations(connection);

  progress("DEVELOPMENT_INFRA_PHASE_VERCEL");
  const secrets = deriveInfrastructureSecrets(config.masterSecret);
  const passwords = generateSyntheticPasswords();
  await providers.vercel.ensurePreviewEnvironment({
    DATABASE_URL: connection.pooledUrl,
    DIRECT_URL: connection.directUrl,
    AI_PROVIDER_DISABLED: "1",
    ATTACHMENT_STORAGE_ENABLED: "1",
    STAGING_HEALTH_PROOF_SECRET: secrets.healthProofSecret,
  });
  await providers.vercel.removeLegacyPreviewEnvironment();
  await providers.vercel.ensureProtectionBypass(secrets.vercelBypassSecret);
  const deployment = await providers.vercel.deployPreview(repository);
  if (deployment.sha !== repository.sha) throw new Error("DEVELOPMENT_INFRA_VERCEL_SHA_MISMATCH");
  await providers.verifyApplication({
    baseUrl: deployment.url,
    projectName: config.vercelProjectName,
    databaseUrl: connection.pooledUrl,
    authMode: "postgres-local-v1",
    healthProofSecret: secrets.healthProofSecret,
    bypassSecret: secrets.vercelBypassSecret,
    deploymentSha: repository.sha,
  });

  progress("DEVELOPMENT_INFRA_PHASE_GITHUB_ENVIRONMENT");
  await providers.github.ensureEnvironment(repository);
  const variables: Record<string, string> = {
    STAGING_VERCEL_PROJECT_NAME: config.vercelProjectName,
    STAGING_DATABASE_NAME: config.neonDatabaseName,
    STAGING_TEST_PRIMARY_SCHOOL_CODE: syntheticFixtures.primarySchoolCode,
    STAGING_TEST_SECONDARY_SCHOOL_CODE: syntheticFixtures.secondarySchoolCode,
    STAGING_TEST_TEACHER_STAFF_NO: syntheticFixtures.teacherStaffNo,
    STAGING_TEST_STUDENT_NO: syntheticFixtures.studentNo,
    STAGING_TEST_OTHER_STUDENT_NO: syntheticFixtures.otherStudentNo,
    STAGING_TEST_OTHER_TEACHER_STAFF_NO: syntheticFixtures.otherTeacherStaffNo,
    STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO: syntheticFixtures.disabledAccountStudentNo,
    STAGING_TEST_DISABLED_SCHOOL_CODE: syntheticFixtures.disabledSchoolCode,
    STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO: syntheticFixtures.disabledSchoolTeacherStaffNo,
    ...Object.fromEntries(attestations.map((name) => [name, "true"])),
  };
  for (const [name, value] of Object.entries(variables)) await providers.github.setVariable(name, value);
  await providers.github.deleteVariable("STAGING_CLERK_INSTANCE_ATTESTED");
  await providers.github.deleteVariable("STAGING_ACCEPTANCE_CLERK_TOKENS_ATTESTED");
  const secretsForGitHub: Record<string, string> = {
    STAGING_BASE_URL: deployment.url,
    STAGING_DATABASE_URL: connection.pooledUrl,
    STAGING_DIRECT_URL: connection.directUrl,
    STAGING_HEALTH_PROOF_SECRET: secrets.healthProofSecret,
    STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: secrets.vercelBypassSecret,
    ...passwords,
  };
  for (const [name, value] of Object.entries(secretsForGitHub)) await providers.github.setSecret(name, value);
  for (const name of [
    "STAGING_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "STAGING_CLERK_SECRET_KEY",
    "STAGING_TEST_TEACHER_CLERK_ID",
    "STAGING_TEST_STUDENT_CLERK_ID",
    "STAGING_TEST_OTHER_STUDENT_CLERK_ID",
    "STAGING_TEST_OTHER_TEACHER_CLERK_ID",
  ] as const) await providers.github.deleteSecret(name);

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
    STAGING_HEALTH_PROOF_SECRET: secrets.healthProofSecret,
    STAGING_VERCEL_AUTOMATION_BYPASS_SECRET: secrets.vercelBypassSecret,
    STAGING_DEPLOYMENT_PROTECTION_REQUIRED: "1",
    STAGING_AUTH_MODE: "postgres-local-v1",
    CDAS_DEPLOYMENT_ID: repository.sha,
    CDAS_SOURCE_FINGERPRINT: createSourceFingerprint(),
    GITHUB_RUN_ID: run.id,
    GITHUB_RUN_ATTEMPT: String(run.attempt),
    STAGING_ACCEPTANCE_TEST_TEACHER_NAME: acceptanceTeacherDisplayName,
    STAGING_ACCEPTANCE_TEST_STUDENT_NAME: acceptanceStudentDisplayName,
    STAGING_ACCEPTANCE_TEST_OTHER_STUDENT_NAME: acceptanceOtherStudentDisplayName,
    STAGING_ACCEPTANCE_TEST_OTHER_TEACHER_NAME: acceptanceOtherTeacherDisplayName,
    ...Object.fromEntries(attestations.map((name) => [name, "true"])),
    STAGING_TEST_PRIMARY_SCHOOL_CODE: syntheticFixtures.primarySchoolCode,
    STAGING_TEST_SECONDARY_SCHOOL_CODE: syntheticFixtures.secondarySchoolCode,
    STAGING_TEST_TEACHER_STAFF_NO: syntheticFixtures.teacherStaffNo,
    STAGING_TEST_STUDENT_NO: syntheticFixtures.studentNo,
    STAGING_TEST_OTHER_STUDENT_NO: syntheticFixtures.otherStudentNo,
    STAGING_TEST_OTHER_TEACHER_STAFF_NO: syntheticFixtures.otherTeacherStaffNo,
    STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO: syntheticFixtures.disabledAccountStudentNo,
    STAGING_TEST_DISABLED_SCHOOL_CODE: syntheticFixtures.disabledSchoolCode,
    STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO: syntheticFixtures.disabledSchoolTeacherStaffNo,
  } });
  progress("DEVELOPMENT_INFRA_PASS");
  return { runUrl: run.url, environment: infrastructureEnvironment };
}
