import { readdir } from "node:fs/promises";
import path from "node:path";

import type { CheckStatus, StagingCheck } from "./contracts";
import { historyProtectionDefinitionManifest } from "./database-manifest";

export type MigrationMetadata = Readonly<{
  migrationName: string;
  finished: boolean;
  rolledBack: boolean;
  hasLogs: boolean;
}>;

export type DatabaseInspection = Readonly<{
  databaseName: string;
  serverVersionNumber: number;
  migrationsTablePresent: boolean;
  migrations: readonly MigrationMetadata[];
  historyProtectionObjectNames: readonly string[];
  historyProtectionDefinitionHashes: Readonly<Record<string, string>>;
}>;

export type DatabaseVerificationResult = Readonly<{
  schema: "staging-database.v1";
  status: "PASS" | "FAIL";
  checks: readonly StagingCheck[];
  stagingSyntheticDecision: "GO" | "NO_GO";
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
}>;

function check(code: string, condition: boolean): StagingCheck {
  return { code, status: condition ? "PASS" : "FAIL" };
}

export const requiredHistoryProtectionFunctions = [
  "assert_activity_release_integrity",
  "assert_close_release_integrity",
  "assert_teacher_feedback_target_current",
  "cdas_activity_content_v1_canonical",
  "cdas_close_release_payload_canonical",
  "cdas_publish_due_at_is_valid",
  "cdas_publish_payload_canonical",
  "cdas_text_has_visible_content",
  "enforce_action_intent_lifecycle",
  "enforce_activity_draft_lifecycle",
  "enforce_activity_draft_revision_provenance",
  "enforce_activity_release_integrity",
  "enforce_activity_release_lifecycle",
  "enforce_agent_run_lifecycle",
  "enforce_classroom_membership_history",
  "enforce_close_release_integrity",
  "enforce_new_publish_due_at_contract",
  "enforce_sealed_activity_draft",
  "enforce_submission_container_lifecycle",
  "enforce_submission_working_copy_lifecycle",
  "enforce_teacher_feedback_container_lifecycle",
  "enforce_teacher_feedback_revision_contract",
  "reject_immutable_row_mutation",
  "require_activity_draft_revision_consistency",
  "require_agent_draft_revision_success",
  "require_submission_revision_consistency",
  "require_submission_revision_working_copy",
  "require_teacher_feedback_revision_consistency",
] as const;

export const requiredHistoryProtectionTriggers = [
  "action_audits_append_only",
  "action_intents_lifecycle_guard",
  "action_intents_publish_due_at_contract",
  "activity_draft_revisions_append_only",
  "activity_draft_revisions_head_consistency",
  "activity_draft_revisions_provenance_guard",
  "activity_draft_revisions_require_succeeded_agent_run",
  "activity_drafts_lifecycle_guard",
  "activity_drafts_revision_consistency",
  "activity_drafts_sealed_history",
  "activity_release_snapshots_append_only",
  "activity_releases_close_integrity",
  "activity_releases_integrity",
  "activity_releases_lifecycle_guard",
  "agent_runs_lifecycle_guard",
  "agent_runs_reject_unsuccessful_draft_history",
  "classroom_memberships_history_guard",
  "close_action_intents_require_release",
  "idempotency_records_append_only",
  "publish_action_intents_require_release",
  "sealed_activity_drafts_require_release",
  "submission_revisions_append_only",
  "submission_revisions_require_working_copy",
  "submission_revisions_sequence_consistency",
  "submission_working_copies_lifecycle_guard",
  "submission_working_copies_revision_consistency",
  "submissions_container_lifecycle_guard",
  "submissions_revision_consistency",
  "teacher_feedback_container_lifecycle_guard",
  "teacher_feedback_revision_consistency",
  "teacher_feedback_revisions_append_only",
  "teacher_feedback_revisions_contract_guard",
  "teacher_feedback_revisions_sequence_consistency",
] as const;

export const requiredHistoryProtectionConstraints = [
  "action_audits_agent_run_id_fkey",
  "action_intents_agent_run_id_fkey",
  "action_intents_status_timestamps",
  "activity_draft_revisions_agent_run_id_fkey",
  "activity_draft_revisions_source_provenance",
  "activity_release_snapshots_release_id_source_draft_id_fkey",
  "activity_releases_action_intent_id_fkey",
  "activity_releases_close_action_intent_id_fkey",
  "activity_releases_lifecycle",
  "agent_runs_terminal_shape",
  "classroom_memberships_no_overlapping_intervals",
  "submission_revisions_text_contract",
  "teacher_feedback_revisions_action_intent_id_fkey",
  "teacher_feedback_revisions_source_provenance",
] as const;

export function evaluateDatabaseInspection(
  inspection: DatabaseInspection,
  expectedDatabaseName: string,
  expectedMigrationNames: readonly string[],
): DatabaseVerificationResult {
  const actualNames = inspection.migrations.map((migration) => migration.migrationName);
  const expectedNameSet = new Set(expectedMigrationNames);
  const unknownMigrations = actualNames.some((name) => !expectedNameSet.has(name));
  const successfulMigrationCounts = new Map(
    expectedMigrationNames.map((name) => [
      name,
      inspection.migrations.filter(
        (migration) =>
          migration.migrationName === name &&
          migration.finished &&
          !migration.rolledBack &&
          !migration.hasLogs,
      ).length,
    ]),
  );
  const pendingOrDuplicateSuccessfulMigration = expectedMigrationNames.some(
    (name) => successfulMigrationCounts.get(name) !== 1,
  );
  // `prisma migrate resolve --rolled-back` intentionally retains a failed
  // attempt before a later successful retry. That append-only recovery history
  // is healthy only when the same known migration has exactly one clean success.
  const failedMigration =
    pendingOrDuplicateSuccessfulMigration ||
    inspection.migrations.some((migration) => {
      const successful =
        migration.finished && !migration.rolledBack && !migration.hasLogs;
      const resolvedHistoricalAttempt =
        migration.rolledBack &&
        !migration.finished &&
        successfulMigrationCounts.get(migration.migrationName) === 1;
      return !successful && !resolvedHistoricalAttempt;
    });
  const pendingMigrations = expectedMigrationNames.some(
    (name) => successfulMigrationCounts.get(name) !== 1,
  );
  const expectedHistoryKeys = Object.keys(historyProtectionDefinitionManifest);
  const exactHistoryObjectSet =
    inspection.historyProtectionObjectNames.length === expectedHistoryKeys.length &&
    new Set(inspection.historyProtectionObjectNames).size === expectedHistoryKeys.length &&
    expectedHistoryKeys.every((name) => inspection.historyProtectionObjectNames.includes(name));
  const exactHistoryHashSet =
    Object.keys(inspection.historyProtectionDefinitionHashes).length === expectedHistoryKeys.length &&
    expectedHistoryKeys.every(
      (name) => inspection.historyProtectionDefinitionHashes[name] === historyProtectionDefinitionManifest[name],
    );
  const checks = [
    check("DATABASE_EXPECTED_NAME", inspection.databaseName === expectedDatabaseName),
    check("POSTGRESQL_17_OR_NEWER", inspection.serverVersionNumber >= 170000),
    check("PRISMA_MIGRATIONS_TABLE_PRESENT", inspection.migrationsTablePresent),
    check("PRISMA_MIGRATIONS_NO_FAILED_ROWS", !failedMigration),
    check("PRISMA_MIGRATIONS_NO_UNKNOWN", !unknownMigrations),
    check("PRISMA_MIGRATIONS_NO_PENDING", !pendingMigrations),
    check("HISTORY_PROTECTION_OBJECTS_PRESENT", exactHistoryObjectSet),
    check("HISTORY_PROTECTION_DEFINITIONS_MATCH", exactHistoryHashSet),
  ];
  const status = checks.every((candidate) => candidate.status === "PASS")
    ? "PASS"
    : "FAIL";
  return {
    schema: "staging-database.v1",
    status,
    checks,
    stagingSyntheticDecision: status === "PASS" ? "GO" : "NO_GO",
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}

export function failedDatabaseVerification(code: string): DatabaseVerificationResult {
  return {
    schema: "staging-database.v1",
    status: "FAIL",
    checks: [{ code, status: "FAIL" }],
    stagingSyntheticDecision: "NO_GO",
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}

export async function repositoryMigrationNames(): Promise<string[]> {
  const directory = path.resolve(process.cwd(), "prisma", "migrations");
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function combinesDatabaseResults(
  results: readonly DatabaseVerificationResult[],
): DatabaseVerificationResult {
  const checks: StagingCheck[] = results.flatMap((result, index) =>
    result.checks.map((candidate) => ({
      ...candidate,
      code: `DATABASE_CONNECTION_${index + 1}_${candidate.code}`,
    })),
  );
  const status: CheckStatus = checks.every((candidate) => candidate.status === "PASS")
    ? "PASS"
    : "FAIL";
  return {
    schema: "staging-database.v1",
    status,
    checks,
    stagingSyntheticDecision: status === "PASS" ? "GO" : "NO_GO",
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}
