import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

import {
  agentAcceptanceEditedSummary,
  agentAcceptanceEvidenceText,
  agentAcceptanceFeedbackText,
  agentAcceptanceNamespace,
  stableAgentAcceptanceError,
} from "./contracts";
import { agentOutputDirectory, writeAgentArtifact } from "./output";
import { assertAgentBrowserPrerequisites } from "./prerequisites";

type Check = Readonly<{ code: string; status: "PASS" | "FAIL" }>;

export type VerificationRow = Readonly<Record<string, boolean>>;

export const agentVerificationCodes = [
  "EXACT_CLASSROOM_MEMBERSHIPS",
  "EXACT_SEALED_DRAFT_AND_REVISIONS",
  "EXACT_CLOSED_RELEASE_AND_SNAPSHOT",
  "EXACT_PUBLISH_INTENT_AND_APPROVAL",
  "EXACT_THREE_AGENT_RUNS",
  "EXACT_AGENT_AUDIT_PROVENANCE",
  "EXACT_AGENT_IDEMPOTENCY_PROVENANCE",
  "EXACT_PRIMARY_STUDENT_SUBMISSION",
  "EXACT_TEACHER_FEEDBACK",
  "EXACT_CLOSE_INTENT_AND_UI_AUDITS",
  "EXACT_STALE_WRITE_REJECTION",
  "ZERO_OTHER_STUDENT_HISTORY",
  "ZERO_OTHER_TEACHER_ACTIONS",
] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

export function evaluateAgentVerification(
  row: VerificationRow | undefined,
): readonly Check[] {
  const passing: Record<(typeof agentVerificationCodes)[number], boolean> = {
    EXACT_CLASSROOM_MEMBERSHIPS: Boolean(row?.classroom),
    EXACT_SEALED_DRAFT_AND_REVISIONS: Boolean(row?.draft && row.revision),
    EXACT_CLOSED_RELEASE_AND_SNAPSHOT: Boolean(row?.release && row.snapshot),
    EXACT_PUBLISH_INTENT_AND_APPROVAL: Boolean(row?.intent),
    EXACT_THREE_AGENT_RUNS: Boolean(row?.runs),
    EXACT_AGENT_AUDIT_PROVENANCE: Boolean(row?.audits),
    EXACT_AGENT_IDEMPOTENCY_PROVENANCE: Boolean(row?.idempotency),
    EXACT_PRIMARY_STUDENT_SUBMISSION: Boolean(row?.primarySubmission),
    EXACT_TEACHER_FEEDBACK: Boolean(row?.teacherFeedback),
    EXACT_CLOSE_INTENT_AND_UI_AUDITS: Boolean(row?.closeIntentAndAudits),
    EXACT_STALE_WRITE_REJECTION: Boolean(row?.staleWrite),
    ZERO_OTHER_STUDENT_HISTORY: Boolean(row?.otherStudentHistory),
    ZERO_OTHER_TEACHER_ACTIONS: Boolean(row?.otherTeacherActions),
  };
  return agentVerificationCodes.map((code) => ({
    code,
    status: passing[code] ? "PASS" : "FAIL",
  }));
}

async function readBrowserWindow(marker: string): Promise<{
  startedAt: string;
  completedAt: string;
}> {
  const value = JSON.parse(
    await readFile(
      path.join(agentOutputDirectory(marker), "browser.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const startedAt =
    typeof value.startedAt === "string" ? Date.parse(value.startedAt) : Number.NaN;
  const completedAt =
    typeof value.completedAt === "string"
      ? Date.parse(value.completedAt)
      : Number.NaN;
  if (
    value.schema !== "staging-agent-acceptance-browser.v1" ||
    value.status !== "PASS" ||
    Number.isNaN(startedAt) ||
    Number.isNaN(completedAt) ||
    startedAt >= completedAt
  ) {
    throw new Error("STAGING_AGENT_ACCEPTANCE_BROWSER_WINDOW_INVALID");
  }
  return {
    startedAt: value.startedAt as string,
    completedAt: value.completedAt as string,
  };
}

/**
 * Every relation is rooted in the marker-derived classroom and unique title.
 * The query returns booleans only; resource IDs, prompts, content, and secrets
 * never leave the read-only database transaction.
 */
export const verificationSql = `
WITH teacher AS (
  SELECT id
  FROM app_users
  WHERE auth_subject = $4
    AND role = 'TEACHER'
    AND display_name = 'CDAS Staging Synthetic Teacher'
),
student AS (
  SELECT id
  FROM app_users
  WHERE auth_subject = $5
    AND role = 'STUDENT'
    AND display_name = 'CDAS Staging Synthetic Student'
),
other_student AS (
  SELECT id
  FROM app_users
  WHERE auth_subject = $10
    AND role = 'STUDENT'
    AND display_name = 'CDAS Staging Synthetic Other Student'
),
marker_drafts AS (
  SELECT draft.*
  FROM activity_drafts AS draft
  WHERE draft.title = $3
    AND draft.owner_id = (SELECT id FROM teacher)
),
target AS (
  SELECT
    d.*,
    release.id AS release_id,
    release.publisher_id,
    release.classroom_id,
    release.action_intent_id,
    release.close_action_intent_id,
    release.status AS release_status,
    release.published_at,
    release.due_at,
    release.closed_at,
    release.archived_at
  FROM marker_drafts AS d
  JOIN activity_releases AS release ON release.source_draft_id = d.id
),
agent_revision AS (
  SELECT revision.*
  FROM activity_draft_revisions AS revision
  JOIN marker_drafts AS draft ON draft.id = revision.draft_id
  WHERE revision.version = 1
    AND revision.source = 'AGENT'
    AND revision.agent_run_id IS NOT NULL
),
manual_revision AS (
  SELECT revision.*
  FROM activity_draft_revisions AS revision
  JOIN target ON target.id = revision.draft_id
  WHERE revision.version = 2
    AND revision.source = 'MANUAL'
    AND revision.agent_run_id IS NULL
),
intent AS (
  SELECT intent.*
  FROM action_intents AS intent
  JOIN target ON target.action_intent_id = intent.id
  WHERE intent.action_name = 'publish_activity_release'
    AND intent.target_type = 'ActivityDraft'
    AND intent.target_id = target.id
    AND intent.expected_version = 2
    AND intent.status = 'EXECUTED'
    AND intent.actor_id = (SELECT id FROM teacher)
    AND intent.decided_by_id = (SELECT id FROM teacher)
    AND intent.agent_run_id IS NOT NULL
    AND intent.decided_at IS NOT NULL
    AND intent.executed_at IS NOT NULL
    AND intent.created_at <= intent.decided_at
    AND intent.decided_at <= intent.executed_at
    AND intent.executed_at <= target.published_at
    AND intent.payload = jsonb_build_object(
      'draftId', target.id::text,
      'expectedDraftVersion', 2,
      'classroomId', target.classroom_id::text,
      'dueAt', NULL
    )
    AND intent.payload_hash ~ '^[a-f0-9]{64}$'
),
session_runs AS (
  SELECT run.id
  FROM agent_runs AS run
  WHERE run.actor_id = (SELECT id FROM teacher)
    AND run.model = $6
    AND run.status = 'SUCCEEDED'
    AND run.completed_at IS NOT NULL
    AND run.failure_code IS NULL
    AND run.started_at >= $7::timestamptz
    AND run.completed_at <= $8::timestamptz
    AND run.started_at <= run.completed_at
),
run1 AS (
  SELECT run.id
  FROM session_runs AS run
  JOIN agent_revision AS revision ON revision.agent_run_id = run.id
),
run3 AS (
  SELECT run.id
  FROM session_runs AS run
  JOIN intent ON intent.agent_run_id = run.id
),
run2 AS (
  SELECT run.id
  FROM session_runs AS run
  WHERE run.id NOT IN (SELECT id FROM run1 UNION SELECT id FROM run3)
    AND NOT EXISTS (
      SELECT 1 FROM activity_draft_revisions WHERE agent_run_id = run.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM action_intents WHERE agent_run_id = run.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM action_audits WHERE agent_run_id = run.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM teacher_feedback_revisions WHERE agent_run_id = run.id
    )
),
snapshot AS (
  SELECT snapshot.*
  FROM activity_release_snapshots AS snapshot
  JOIN target ON target.release_id = snapshot.release_id
  JOIN manual_revision AS revision ON revision.draft_id = target.id
  WHERE snapshot.source_draft_id = target.id
    AND snapshot.source_draft_version = 2
    AND snapshot.schema_version = 1
    AND snapshot.content = jsonb_build_object(
      'schemaVersion', 1,
      'title', revision.title,
      'summary', revision.summary,
      'learningObjectives', to_jsonb(revision.learning_objectives),
      'taskInstructions', revision.task_instructions,
      'evidenceRequirements', to_jsonb(revision.evidence_requirements),
      'feedbackCriteria', to_jsonb(revision.feedback_criteria)
    )
    AND snapshot.content_hash ~ '^[a-f0-9]{64}$'
),
target_audits AS (
  SELECT audit.*
  FROM action_audits AS audit
  JOIN target ON true
  WHERE audit.actor_id = (SELECT id FROM teacher)
    AND (
      (audit.target_type = 'ActivityDraft' AND audit.target_id = target.id)
      OR (
        audit.target_type = 'ActionIntent'
        AND audit.target_id = (SELECT id FROM intent)
      )
      OR audit.action_intent_id = (SELECT id FROM intent)
    )
),
target_idempotency AS (
  SELECT record.*
  FROM idempotency_records AS record
  JOIN target ON true
  WHERE record.actor_id = (SELECT id FROM teacher)
    AND record.command_name IN (
      'save_activity_draft',
      'prepare_publish_activity_intent',
      'publish_activity_release'
    )
    AND record.resource_id IN (
      target.id,
      (SELECT id FROM agent_revision),
      (SELECT id FROM manual_revision),
      (SELECT id FROM intent),
      target.release_id
    )
)
SELECT
  (
    (SELECT count(*) = 1
      FROM classrooms AS classroom
      WHERE classroom.id = $1::uuid
        AND classroom.name = $2
        AND classroom.manager_id = (SELECT id FROM teacher))
    AND
    (SELECT count(*) = 1
      FROM classroom_memberships AS membership
      WHERE membership.classroom_id = $1::uuid
        AND membership.student_id = (SELECT id FROM student)
        AND membership.ended_at IS NULL)
    AND
    (SELECT count(*) = 1
      FROM classroom_memberships AS membership
      WHERE membership.classroom_id = $1::uuid
        AND membership.student_id = (SELECT id FROM other_student)
        AND membership.ended_at IS NULL)
    AND
    (SELECT count(*) = 2
      FROM classroom_memberships
      WHERE classroom_id = $1::uuid)
  ) AS classroom,
  (
    (SELECT count(*) = 1 FROM marker_drafts)
    AND
    (SELECT count(*) = 1
      FROM target
      WHERE target.status = 'SEALED'
        AND target.version = 2
        AND target.sealed_at IS NOT NULL
        AND target.sealed_at = target.published_at
        AND target.summary = $9
        AND btrim(target.task_instructions) <> ''
        AND cardinality(target.learning_objectives) > 0
        AND cardinality(target.evidence_requirements) > 0
        AND cardinality(target.feedback_criteria) > 0
        AND NOT EXISTS (
          SELECT 1 FROM unnest(target.learning_objectives) AS item
          WHERE btrim(item) = ''
        )
        AND NOT EXISTS (
          SELECT 1 FROM unnest(target.evidence_requirements) AS item
          WHERE btrim(item) = ''
        )
        AND NOT EXISTS (
          SELECT 1 FROM unnest(target.feedback_criteria) AS item
          WHERE btrim(item) = ''
        ))
  ) AS draft,
  (
    (SELECT count(*) = 1
      FROM agent_revision AS revision
      JOIN target ON target.id = revision.draft_id
      WHERE revision.title = target.title
        AND btrim(revision.summary) <> ''
        AND revision.summary <> target.summary
        AND revision.learning_objectives = target.learning_objectives
        AND revision.task_instructions = target.task_instructions
        AND revision.evidence_requirements = target.evidence_requirements
        AND revision.feedback_criteria = target.feedback_criteria)
    AND
    (SELECT count(*) = 1
      FROM manual_revision AS revision
      JOIN target ON target.id = revision.draft_id
      WHERE revision.title = target.title
        AND revision.summary = $9
        AND revision.learning_objectives = target.learning_objectives
        AND revision.task_instructions = target.task_instructions
        AND revision.evidence_requirements = target.evidence_requirements
        AND revision.feedback_criteria = target.feedback_criteria)
    AND
    (SELECT count(*) = 2 FROM activity_draft_revisions WHERE draft_id = (SELECT id FROM target))
  ) AS revision,
  (
    SELECT count(*) = 1
    FROM target
    WHERE target.release_status = 'CLOSED'
      AND target.publisher_id = (SELECT id FROM teacher)
      AND target.classroom_id = $1::uuid
      AND target.action_intent_id = (SELECT id FROM intent)
      AND target.close_action_intent_id IS NOT NULL
      AND target.due_at IS NULL
      AND target.closed_at IS NOT NULL
      AND target.published_at <= target.closed_at
      AND target.archived_at IS NULL
  ) AS release,
  (
    SELECT count(*) = 1
    FROM snapshot
    WHERE snapshot.content_hash = (
      SELECT record.response->>'snapshotHash'
      FROM target_idempotency AS record
      WHERE record.command_name = 'publish_activity_release'
    )
  ) AS snapshot,
  (SELECT count(*) = 1 FROM intent) AS intent,
  (
    (SELECT count(*) = 1 FROM run1)
    AND (SELECT count(*) = 1 FROM run2)
    AND (SELECT count(*) = 1 FROM run3)
    AND (SELECT count(*) = 3 FROM session_runs)
    AND NOT EXISTS (SELECT 1 FROM run1 JOIN run3 USING (id))
  ) AS runs,
  (
    (SELECT count(*) = 5 FROM target_audits)
    AND
    (SELECT count(*) = 1
      FROM target_audits AS audit
      JOIN target ON true
      WHERE audit.action_name = 'save_activity_draft'
        AND audit.source = 'AGENT'
        AND audit.agent_run_id = (SELECT id FROM run1)
        AND audit.action_intent_id IS NULL
        AND audit.target_type = 'ActivityDraft'
        AND audit.target_id = target.id
        AND audit.idempotency_key ~ '^assistant_draft_[a-f0-9]{40}$'
        AND audit.outcome = 'SUCCEEDED'
        AND audit.error_code IS NULL
        AND audit.before_version IS NULL
        AND audit.after_version = 1
        AND audit.result_resource_id = (SELECT id FROM agent_revision))
    AND
    (SELECT count(*) = 1
      FROM target_audits AS audit
      JOIN target ON true
      WHERE audit.action_name = 'save_activity_draft'
        AND audit.source = 'UI'
        AND audit.agent_run_id IS NULL
        AND audit.action_intent_id IS NULL
        AND audit.target_type = 'ActivityDraft'
        AND audit.target_id = target.id
        AND audit.idempotency_key ~ '^save_activity_draft_[0-9a-f-]{36}$'
        AND audit.outcome = 'SUCCEEDED'
        AND audit.error_code IS NULL
        AND audit.before_version = 1
        AND audit.after_version = 2
        AND audit.result_resource_id = (SELECT id FROM manual_revision))
    AND
    (SELECT count(*) = 1
      FROM target_audits AS audit
      WHERE audit.action_name = 'prepare_publish_activity_intent'
        AND audit.source = 'AGENT'
        AND audit.agent_run_id = (SELECT id FROM run3)
        AND audit.action_intent_id = (SELECT id FROM intent)
        AND audit.target_type = 'ActionIntent'
        AND audit.target_id = (SELECT id FROM intent)
        AND audit.idempotency_key ~ '^assistant_prepare_[a-f0-9]{40}$'
        AND audit.outcome = 'SUCCEEDED'
        AND audit.error_code IS NULL
        AND audit.before_version = 2
        AND audit.after_version = 2
        AND audit.result_resource_id = (SELECT id FROM intent))
    AND
    (SELECT count(*) = 1
      FROM target_audits AS audit
      WHERE audit.action_name = 'decide_action_intent'
        AND audit.source = 'UI'
        AND audit.agent_run_id = (SELECT id FROM run3)
        AND audit.action_intent_id = (SELECT id FROM intent)
        AND audit.target_type = 'ActionIntent'
        AND audit.target_id = (SELECT id FROM intent)
        AND audit.idempotency_key IS NULL
        AND audit.outcome = 'SUCCEEDED'
        AND audit.error_code IS NULL
        AND audit.before_version IS NULL
        AND audit.after_version IS NULL
        AND audit.result_resource_id IS NULL)
    AND
    (SELECT count(*) = 1
      FROM target_audits AS audit
      JOIN target ON true
      WHERE audit.action_name = 'publish_activity_release'
        AND audit.source = 'AGENT'
        AND audit.agent_run_id = (SELECT id FROM run3)
        AND audit.action_intent_id = (SELECT id FROM intent)
        AND audit.target_type = 'ActivityRelease'
        AND audit.target_id = target.release_id
        AND audit.idempotency_key ~ '^assistant_publish_[a-f0-9]{40}$'
        AND audit.outcome = 'SUCCEEDED'
        AND audit.error_code IS NULL
        AND audit.before_version = 2
        AND audit.after_version = 2
        AND audit.result_resource_id = target.release_id)
  ) AS audits,
  (
    (SELECT count(*) = 4 FROM target_idempotency)
    AND
    (SELECT count(*) = 1
      FROM target_idempotency AS record
      JOIN target ON true
      WHERE record.command_name = 'save_activity_draft'
        AND record.idempotency_key ~ '^assistant_draft_[a-f0-9]{40}$'
        AND record.request_hash ~ '^[a-f0-9]{64}$'
        AND record.resource_type = 'ActivityDraftRevision'
        AND record.resource_id = (SELECT id FROM agent_revision)
        AND (SELECT count(*) FROM jsonb_object_keys(record.response)) = 5
        AND record.response->>'draftId' = target.id::text
        AND record.response->>'revisionId' = (SELECT id FROM agent_revision)::text
        AND record.response->>'version' = '1'
        AND record.response->>'status' = 'READY_FOR_PREVIEW'
        AND record.response ? 'savedAt')
    AND
    (SELECT count(*) = 1
      FROM target_idempotency AS record
      JOIN target ON true
      WHERE record.command_name = 'save_activity_draft'
        AND record.idempotency_key ~ '^save_activity_draft_[0-9a-f-]{36}$'
        AND record.request_hash ~ '^[a-f0-9]{64}$'
        AND record.resource_type = 'ActivityDraftRevision'
        AND record.resource_id = (SELECT id FROM manual_revision)
        AND (SELECT count(*) FROM jsonb_object_keys(record.response)) = 5
        AND record.response->>'draftId' = target.id::text
        AND record.response->>'revisionId' = (SELECT id FROM manual_revision)::text
        AND record.response->>'version' = '2'
        AND record.response->>'status' = 'READY_FOR_PREVIEW'
        AND record.response ? 'savedAt')
    AND
    (SELECT count(*) = 1
      FROM target_idempotency AS record
      JOIN target ON true
      WHERE record.command_name = 'prepare_publish_activity_intent'
        AND record.idempotency_key ~ '^assistant_prepare_[a-f0-9]{40}$'
        AND record.request_hash ~ '^[a-f0-9]{64}$'
        AND record.resource_type = 'ActionIntent'
        AND record.resource_id = (SELECT id FROM intent)
        AND (SELECT count(*) FROM jsonb_object_keys(record.response)) = 5
        AND record.response->>'actionIntentId' = (SELECT id FROM intent)::text
        AND record.response->>'draftId' = target.id::text
        AND record.response->>'expectedDraftVersion' = '2'
        AND record.response->>'payloadHash' = (SELECT payload_hash FROM intent)
        AND record.response ? 'expiresAt')
    AND
    (SELECT count(*) = 1
      FROM target_idempotency AS record
      JOIN target ON true
      WHERE record.command_name = 'publish_activity_release'
        AND record.idempotency_key ~ '^assistant_publish_[a-f0-9]{40}$'
        AND record.request_hash ~ '^[a-f0-9]{64}$'
        AND record.resource_type = 'ActivityRelease'
        AND record.resource_id = target.release_id
        AND (SELECT count(*) FROM jsonb_object_keys(record.response)) = 3
        AND record.response->>'releaseId' = target.release_id::text
        AND record.response->>'snapshotHash' = (SELECT content_hash FROM snapshot)
        AND record.response ? 'publishedAt')
  ) AS idempotency
`;

/**
 * This second read-only ledger joins the ordinary UI commands that continue
 * from the Agent-created Release. It deliberately returns booleans only.
 */
export const fullLoopVerificationSql = `
WITH teacher AS (
  SELECT id FROM app_users
  WHERE auth_subject = $3
    AND role = 'TEACHER'
    AND display_name = 'CDAS Staging Synthetic Teacher'
),
student AS (
  SELECT id FROM app_users
  WHERE auth_subject = $4
    AND role = 'STUDENT'
    AND display_name = 'CDAS Staging Synthetic Student'
),
other_student AS (
  SELECT id FROM app_users
  WHERE auth_subject = $5
    AND role = 'STUDENT'
    AND display_name = 'CDAS Staging Synthetic Other Student'
),
other_teacher AS (
  SELECT id FROM app_users
  WHERE auth_subject = $6
    AND role = 'TEACHER'
    AND display_name = 'CDAS Staging Synthetic Other Teacher'
),
target AS (
  SELECT
    release.id AS release_id,
    release.action_intent_id AS publish_intent_id,
    release.close_action_intent_id AS close_intent_id,
    release.status,
    release.published_at,
    release.closed_at
  FROM activity_drafts AS draft
  JOIN activity_releases AS release ON release.source_draft_id = draft.id
  WHERE draft.title = $2
    AND draft.owner_id = (SELECT id FROM teacher)
    AND release.classroom_id = $1::uuid
),
primary_submission AS (
  SELECT submission.*
  FROM submissions AS submission
  JOIN target ON target.release_id = submission.release_id
  WHERE submission.student_id = (SELECT id FROM student)
),
primary_revision AS (
  SELECT revision.*
  FROM submission_revisions AS revision
  JOIN primary_submission AS submission ON submission.id = revision.submission_id
),
feedback_revision AS (
  SELECT
    feedback.id AS feedback_id,
    feedback.teacher_id,
    feedback.version AS feedback_version,
    revision.*
  FROM teacher_feedback AS feedback
  JOIN teacher_feedback_revisions AS revision
    ON revision.teacher_feedback_id = feedback.id
  WHERE feedback.submission_revision_id = (SELECT id FROM primary_revision)
),
feedback_intent AS (
  SELECT intent.*
  FROM action_intents AS intent
  WHERE intent.id = (SELECT action_intent_id FROM feedback_revision)
),
close_intent AS (
  SELECT intent.*
  FROM action_intents AS intent
  JOIN target ON target.close_intent_id = intent.id
),
stale_write_audits AS (
  SELECT audit.*
  FROM action_audits AS audit
  JOIN target ON target.release_id = audit.target_id
  WHERE audit.actor_id = (SELECT id FROM student)
    AND audit.source = 'UI'
    AND audit.agent_run_id IS NULL
    AND audit.action_intent_id IS NULL
    AND audit.action_name = 'save_submission_working_copy'
    AND audit.target_type = 'ActivityRelease'
    AND audit.outcome = 'CONFLICTED'
    AND audit.error_code = 'RELEASE_NOT_ACTIVE'
    AND audit.created_at >= target.closed_at
),
other_teacher_target_audits AS (
  SELECT audit.id
  FROM action_audits AS audit
  JOIN target ON true
  WHERE audit.actor_id = (SELECT id FROM other_teacher)
    AND (
      (audit.target_type = 'ActivityRelease' AND audit.target_id = target.release_id)
      OR (audit.target_type = 'Submission' AND audit.target_id = (SELECT id FROM primary_submission))
      OR audit.action_intent_id IN (
        target.publish_intent_id,
        target.close_intent_id,
        (SELECT id FROM feedback_intent)
      )
    )
)
SELECT
  (
    (SELECT count(*) = 1 FROM primary_submission
      WHERE latest_revision_number = 1)
    AND
    (SELECT count(*) = 1 FROM primary_revision
      WHERE revision_number = 1
        AND base_revision_number = 0
        AND text_evidence = $7
        AND btrim(text_evidence) <> ''
        AND is_late = false)
    AND
    (SELECT count(*) = 1
      FROM action_audits AS audit
      WHERE audit.actor_id = (SELECT id FROM student)
        AND audit.source = 'UI'
        AND audit.agent_run_id IS NULL
        AND audit.action_name = 'submit_submission_revision'
        AND audit.target_type = 'Submission'
        AND audit.target_id = (SELECT id FROM primary_submission)
        AND audit.outcome = 'SUCCEEDED'
        AND audit.error_code IS NULL
        AND audit.after_version = 1
        AND audit.result_resource_id = (SELECT id FROM primary_revision))
  ) AS "primarySubmission",
  (
    (SELECT count(*) = 1 FROM feedback_revision
      WHERE teacher_id = (SELECT id FROM teacher)
        AND feedback_version = 1
        AND version = 1
        AND body = $8
        AND btrim(body) <> ''
        AND body_hash ~ '^[a-f0-9]{64}$'
        AND source = 'MANUAL'
        AND confirmed_by_id = (SELECT id FROM teacher)
        AND agent_run_id IS NULL)
    AND
    (SELECT count(*) = 1 FROM feedback_intent
      WHERE action_name = 'save_teacher_feedback'
        AND target_type = 'Submission'
        AND target_id = (SELECT id FROM primary_submission)
        AND expected_version = 1
        AND status = 'EXECUTED'
        AND actor_id = (SELECT id FROM teacher)
        AND decided_by_id = (SELECT id FROM teacher)
        AND agent_run_id IS NULL
        AND decided_at IS NOT NULL
        AND executed_at IS NOT NULL)
  ) AS "teacherFeedback",
  (
    (SELECT count(*) = 1 FROM target
      WHERE status = 'CLOSED'
        AND closed_at IS NOT NULL
        AND published_at <= closed_at
        AND close_intent_id IS NOT NULL)
    AND
    (SELECT count(*) = 1 FROM close_intent
      WHERE action_name = 'close_activity_release'
        AND target_type = 'ActivityRelease'
        AND target_id = (SELECT release_id FROM target)
        AND expected_version IS NULL
        AND status = 'EXECUTED'
        AND actor_id = (SELECT id FROM teacher)
        AND decided_by_id = (SELECT id FROM teacher)
        AND agent_run_id IS NULL
        AND decided_at IS NOT NULL
        AND executed_at IS NOT NULL)
    AND
    (SELECT count(*) = 1
      FROM action_audits AS audit
      WHERE audit.actor_id = (SELECT id FROM teacher)
        AND audit.source = 'UI'
        AND audit.agent_run_id IS NULL
        AND audit.action_intent_id = (SELECT id FROM feedback_intent)
        AND audit.action_name = 'save_teacher_feedback'
        AND audit.outcome = 'SUCCEEDED'
        AND audit.error_code IS NULL)
    AND
    (SELECT count(*) = 1
      FROM action_audits AS audit
      WHERE audit.actor_id = (SELECT id FROM teacher)
        AND audit.source = 'UI'
        AND audit.agent_run_id IS NULL
        AND audit.action_intent_id = (SELECT id FROM close_intent)
        AND audit.action_name = 'close_activity_release'
        AND audit.outcome = 'SUCCEEDED'
        AND audit.error_code IS NULL)
  ) AS "closeIntentAndAudits",
  (SELECT count(*) = 1 FROM stale_write_audits) AS "staleWrite",
  (
    (SELECT count(*) = 0
      FROM submissions AS submission
      JOIN target ON target.release_id = submission.release_id
      WHERE submission.student_id = (SELECT id FROM other_student))
    AND
    (SELECT count(*) = 0
      FROM submission_revisions AS revision
      JOIN submissions AS submission ON submission.id = revision.submission_id
      JOIN target ON target.release_id = submission.release_id
      WHERE submission.student_id = (SELECT id FROM other_student))
    AND
    (SELECT count(*) = 0
      FROM teacher_feedback_revisions AS feedback_revision
      JOIN teacher_feedback AS feedback
        ON feedback.id = feedback_revision.teacher_feedback_id
      JOIN submission_revisions AS revision
        ON revision.id = feedback.submission_revision_id
      JOIN submissions AS submission ON submission.id = revision.submission_id
      JOIN target ON target.release_id = submission.release_id
      WHERE submission.student_id = (SELECT id FROM other_student))
  ) AS "otherStudentHistory",
  (SELECT count(*) = 0 FROM other_teacher_target_audits) AS "otherTeacherActions"
`;

async function main(): Promise<void> {
  const marker = required("STAGING_RUN_MARKER");
  await assertAgentBrowserPrerequisites(process.env);
  const namespace = agentAcceptanceNamespace(marker);
  const browserWindow = await readBrowserWindow(marker);
  const database = new Client({ connectionString: required("DIRECT_URL") });
  await database.connect();
  try {
    await database.query("BEGIN READ ONLY");
    const result = await database.query<VerificationRow>(verificationSql, [
      namespace.classroomId,
      namespace.classroomName,
      namespace.activityTitle,
      required("STAGING_TEST_TEACHER_CLERK_ID"),
      required("STAGING_TEST_STUDENT_CLERK_ID"),
      required("AI_MODEL"),
      browserWindow.startedAt,
      browserWindow.completedAt,
      agentAcceptanceEditedSummary,
      required("STAGING_TEST_OTHER_STUDENT_CLERK_ID"),
    ]);
    const fullLoop = await database.query<VerificationRow>(
      fullLoopVerificationSql,
      [
        namespace.classroomId,
        namespace.activityTitle,
        required("STAGING_TEST_TEACHER_CLERK_ID"),
        required("STAGING_TEST_STUDENT_CLERK_ID"),
        required("STAGING_TEST_OTHER_STUDENT_CLERK_ID"),
        required("STAGING_TEST_OTHER_TEACHER_CLERK_ID"),
        agentAcceptanceEvidenceText,
        agentAcceptanceFeedbackText,
      ],
    );
    await database.query("ROLLBACK");

    const checks = evaluateAgentVerification({
      ...result.rows[0],
      ...fullLoop.rows[0],
    });
    const status = checks.every((candidate) => candidate.status === "PASS")
      ? "PASS"
      : "FAIL";
    await writeAgentArtifact(marker, "verify.json", {
      schema: "staging-agent-acceptance-verify.v1",
      status,
      checks,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    });
    process.stdout.write(
      `${JSON.stringify({ schema: "staging-agent-acceptance-verify.v1", status })}\n`,
    );
    if (status !== "PASS") process.exitCode = 1;
  } finally {
    await database.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch(async (error: unknown) => {
    try {
      await writeAgentArtifact(
        process.env.STAGING_RUN_MARKER?.trim() ?? "",
        "verify.json",
        {
          schema: "staging-agent-acceptance-verify.v1",
          status: "FAIL",
          checks: [
            { code: stableAgentAcceptanceError(error), status: "FAIL" },
          ],
          realStudentDataAllowed: false,
          productionDecision: "NO_GO",
        },
      );
    } catch {
      // An invalid output marker must not be weakened to preserve evidence.
    }
    process.stdout.write(
      '{"schema":"staging-agent-acceptance-verify.v1","status":"FAIL"}\n',
    );
    process.exitCode = 1;
  });
}
