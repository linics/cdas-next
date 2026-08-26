-- D-034 freezes a teacher's formative next-step recommendation and support
-- level on each newly appended feedback revision. Existing history remains
-- readable without fabricated values.
CREATE TYPE "FeedbackNextStep" AS ENUM ('CONTINUE', 'REVISE');
CREATE TYPE "FeedbackSupportLevel" AS ENUM ('FOUNDATION', 'STANDARD', 'CHALLENGE');

ALTER TABLE "teacher_feedback_revisions"
  ADD COLUMN "next_step" "FeedbackNextStep",
  ADD COLUMN "support_level" "FeedbackSupportLevel",
  ADD CONSTRAINT "teacher_feedback_revisions_structured_fields_together"
    CHECK (
      ("next_step" IS NULL AND "support_level" IS NULL)
      OR ("next_step" IS NOT NULL AND "support_level" IS NOT NULL)
    );

-- Existing rows were confirmed under payload schema v1 and intentionally keep
-- both structured fields null. New insertions must use schema v2 and bind the
-- two fields to the exact executed ActionIntent payload.
CREATE OR REPLACE FUNCTION "enforce_teacher_feedback_revision_contract"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  feedback_teacher_id UUID;
  feedback_version INTEGER;
  feedback_created_at TIMESTAMPTZ(3);
  target_submission_revision_id UUID;
  target_submission_id UUID;
  target_revision_number INTEGER;
  target_submitted_at TIMESTAMPTZ(3);
  intent_actor_id UUID;
  intent_decided_by_id UUID;
  intent_agent_run_id UUID;
  intent_action_name TEXT;
  intent_payload JSONB;
  intent_target_type TEXT;
  intent_target_id UUID;
  intent_expected_version INTEGER;
  intent_status "ActionIntentStatus";
  intent_executed_at TIMESTAMPTZ(3);
BEGIN
  SELECT
    feedback."teacher_id",
    feedback."version",
    feedback."created_at",
    feedback."submission_revision_id",
    revision."submission_id",
    revision."revision_number",
    revision."submitted_at",
    intent."actor_id",
    intent."decided_by_id",
    intent."agent_run_id",
    intent."action_name",
    intent."payload",
    intent."target_type",
    intent."target_id",
    intent."expected_version",
    intent."status",
    intent."executed_at"
  INTO
    feedback_teacher_id,
    feedback_version,
    feedback_created_at,
    target_submission_revision_id,
    target_submission_id,
    target_revision_number,
    target_submitted_at,
    intent_actor_id,
    intent_decided_by_id,
    intent_agent_run_id,
    intent_action_name,
    intent_payload,
    intent_target_type,
    intent_target_id,
    intent_expected_version,
    intent_status,
    intent_executed_at
  FROM "teacher_feedback" AS feedback
  JOIN "submission_revisions" AS revision
    ON revision."id" = feedback."submission_revision_id"
  JOIN "action_intents" AS intent
    ON intent."id" = NEW."action_intent_id"
  WHERE feedback."id" = NEW."teacher_feedback_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback revision requires a feedback container and action intent'
      USING ERRCODE = '23514';
  END IF;

  PERFORM "assert_teacher_feedback_target_current"(
    target_submission_revision_id,
    feedback_teacher_id
  );

  IF NEW."version" <> feedback_version
    OR NEW."confirmed_by_id" <> feedback_teacher_id THEN
    RAISE EXCEPTION 'feedback revision version or confirmer does not match its container'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."confirmed_at" < target_submitted_at
    OR NEW."confirmed_at" < feedback_created_at
    OR NEW."confirmed_at" IS DISTINCT FROM intent_executed_at THEN
    RAISE EXCEPTION 'feedback confirmation time is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF intent_status <> 'EXECUTED'
    OR intent_actor_id <> feedback_teacher_id
    OR intent_decided_by_id <> feedback_teacher_id
    OR intent_action_name <> 'save_teacher_feedback'
    OR intent_target_type <> 'Submission'
    OR intent_target_id <> target_submission_id
    OR intent_expected_version <> target_revision_number
    OR intent_agent_run_id IS DISTINCT FROM NEW."agent_run_id" THEN
    RAISE EXCEPTION 'feedback revision is not backed by its confirmed action intent'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."next_step" IS NULL OR NEW."support_level" IS NULL
    OR intent_payload ->> 'schemaVersion' IS DISTINCT FROM '2'
    OR intent_payload ->> 'submissionId' IS DISTINCT FROM target_submission_id::text
    OR intent_payload ->> 'submissionRevisionId' IS DISTINCT FROM target_submission_revision_id::text
    OR (intent_payload ->> 'expectedSubmissionRevisionNumber')::INTEGER IS DISTINCT FROM target_revision_number
    OR (intent_payload ->> 'expectedFeedbackVersion')::INTEGER IS DISTINCT FROM NEW."version" - 1
    OR intent_payload ->> 'body' IS DISTINCT FROM NEW."body"
    OR intent_payload ->> 'nextStep' IS DISTINCT FROM NEW."next_step"::text
    OR intent_payload ->> 'supportLevel' IS DISTINCT FROM NEW."support_level"::text
    OR intent_payload ->> 'suggestionAgentRunId' IS DISTINCT FROM NEW."agent_run_id"::text THEN
    RAISE EXCEPTION 'feedback revision differs from its confirmed payload'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
