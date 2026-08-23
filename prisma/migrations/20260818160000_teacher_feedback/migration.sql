-- CreateEnum
CREATE TYPE "FeedbackRevisionSource" AS ENUM ('MANUAL', 'AI_ASSISTED');

-- CreateTable
CREATE TABLE "teacher_feedback" (
    "id" UUID NOT NULL,
    "submission_revision_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teacher_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_feedback_revisions" (
    "id" UUID NOT NULL,
    "teacher_feedback_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "body_hash" CHAR(64) NOT NULL,
    "source" "FeedbackRevisionSource" NOT NULL,
    "confirmed_by_id" UUID NOT NULL,
    "action_intent_id" UUID NOT NULL,
    "agent_run_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_feedback_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teacher_feedback_submission_revision_id_key"
  ON "teacher_feedback"("submission_revision_id");

CREATE INDEX "teacher_feedback_teacher_id_updated_at_idx"
  ON "teacher_feedback"("teacher_id", "updated_at");

CREATE UNIQUE INDEX "teacher_feedback_revisions_action_intent_id_key"
  ON "teacher_feedback_revisions"("action_intent_id");

CREATE UNIQUE INDEX "teacher_feedback_revisions_teacher_feedback_id_version_key"
  ON "teacher_feedback_revisions"("teacher_feedback_id", "version");

CREATE INDEX "teacher_feedback_revisions_agent_run_id_idx"
  ON "teacher_feedback_revisions"("agent_run_id");

-- AddForeignKey
ALTER TABLE "teacher_feedback"
  ADD CONSTRAINT "teacher_feedback_submission_revision_id_fkey"
  FOREIGN KEY ("submission_revision_id") REFERENCES "submission_revisions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_feedback"
  ADD CONSTRAINT "teacher_feedback_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "app_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_feedback_revisions"
  ADD CONSTRAINT "teacher_feedback_revisions_teacher_feedback_id_fkey"
  FOREIGN KEY ("teacher_feedback_id") REFERENCES "teacher_feedback"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_feedback_revisions"
  ADD CONSTRAINT "teacher_feedback_revisions_confirmed_by_id_fkey"
  FOREIGN KEY ("confirmed_by_id") REFERENCES "app_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_feedback_revisions"
  ADD CONSTRAINT "teacher_feedback_revisions_action_intent_id_fkey"
  FOREIGN KEY ("action_intent_id") REFERENCES "action_intents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_feedback_revisions"
  ADD CONSTRAINT "teacher_feedback_revisions_agent_run_id_fkey"
  FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks that Prisma cannot express in the schema.
ALTER TABLE "teacher_feedback"
  ADD CONSTRAINT "teacher_feedback_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "teacher_feedback_updated_after_create" CHECK (
    "updated_at" >= "created_at"
  );

ALTER TABLE "teacher_feedback_revisions"
  ADD CONSTRAINT "teacher_feedback_revisions_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "teacher_feedback_revisions_body_visible" CHECK (
    "cdas_text_has_visible_content"("body")
  ),
  ADD CONSTRAINT "teacher_feedback_revisions_body_bounded" CHECK (
    char_length("body") <= 10000
  ),
  ADD CONSTRAINT "teacher_feedback_revisions_hash_format" CHECK (
    "body_hash" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "teacher_feedback_revisions_source_provenance" CHECK (
    ("source" = 'MANUAL' AND "agent_run_id" IS NULL)
    OR ("source" = 'AI_ASSISTED' AND "agent_run_id" IS NOT NULL)
  );

-- A final feedback write must name the current submitted revision. Lock the
-- Submission row so a student submission and a teacher confirmation have one
-- deterministic database order. Historical feedback remains valid after a
-- later resubmission; this check runs only while new feedback is appended.
CREATE FUNCTION "assert_teacher_feedback_target_current"(
  target_submission_revision_id UUID,
  target_teacher_id UUID
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  submitted_revision_number INTEGER;
  current_revision_number INTEGER;
  release_publisher_id UUID;
  classroom_manager_id UUID;
  teacher_role "UserRole";
BEGIN
  SELECT
    revision."revision_number",
    submission."latest_revision_number",
    release."publisher_id",
    classroom."manager_id",
    teacher."role"
  INTO
    submitted_revision_number,
    current_revision_number,
    release_publisher_id,
    classroom_manager_id,
    teacher_role
  FROM "submission_revisions" AS revision
  JOIN "submissions" AS submission
    ON submission."id" = revision."submission_id"
  JOIN "activity_releases" AS release
    ON release."id" = submission."release_id"
  JOIN "classrooms" AS classroom
    ON classroom."id" = release."classroom_id"
  JOIN "app_users" AS teacher
    ON teacher."id" = target_teacher_id
  WHERE revision."id" = target_submission_revision_id
  FOR UPDATE OF submission;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'teacher feedback target does not exist'
      USING ERRCODE = '23514';
  END IF;

  IF submitted_revision_number <> current_revision_number THEN
    RAISE EXCEPTION 'teacher feedback must target the current submission revision'
      USING ERRCODE = '23514';
  END IF;

  IF teacher_role <> 'TEACHER'
    OR target_teacher_id <> release_publisher_id
    OR target_teacher_id <> classroom_manager_id THEN
    RAISE EXCEPTION 'teacher is not authorized for this submission'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- TeacherFeedback is a stable aggregate. Version zero is an ActionIntent
-- precondition only: a persisted aggregate starts at one and advances exactly
-- one step for every confirmed revision.
CREATE FUNCTION "enforce_teacher_feedback_container_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'teacher feedback containers cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'teacher feedback must start at version 1'
        USING ERRCODE = '23514';
    END IF;

    PERFORM "assert_teacher_feedback_target_current"(
      NEW."submission_revision_id",
      NEW."teacher_id"
    );
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."submission_revision_id" IS DISTINCT FROM OLD."submission_revision_id"
    OR NEW."teacher_id" IS DISTINCT FROM OLD."teacher_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'teacher feedback identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'teacher feedback version must advance by one'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'teacher feedback update time cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  PERFORM "assert_teacher_feedback_target_current"(
    NEW."submission_revision_id",
    NEW."teacher_id"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "teacher_feedback_container_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "teacher_feedback"
  FOR EACH ROW EXECUTE FUNCTION "enforce_teacher_feedback_container_lifecycle"();

-- Every immutable feedback revision must be the exact first-party-confirmed
-- ActionIntent for the current Submission revision. The JSON comparisons guard
-- against a direct database write that changes the confirmed target or body.
CREATE FUNCTION "enforce_teacher_feedback_revision_contract"()
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

  IF intent_payload ->> 'schemaVersion' IS DISTINCT FROM '1'
    OR intent_payload ->> 'submissionId' IS DISTINCT FROM target_submission_id::text
    OR intent_payload ->> 'submissionRevisionId' IS DISTINCT FROM target_submission_revision_id::text
    OR (intent_payload ->> 'expectedSubmissionRevisionNumber')::INTEGER IS DISTINCT FROM target_revision_number
    OR (intent_payload ->> 'expectedFeedbackVersion')::INTEGER IS DISTINCT FROM NEW."version" - 1
    OR intent_payload ->> 'body' IS DISTINCT FROM NEW."body"
    OR intent_payload ->> 'suggestionAgentRunId' IS DISTINCT FROM NEW."agent_run_id"::text THEN
    RAISE EXCEPTION 'feedback revision differs from its confirmed payload'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "teacher_feedback_revisions_contract_guard"
  BEFORE INSERT ON "teacher_feedback_revisions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_teacher_feedback_revision_contract"();

CREATE TRIGGER "teacher_feedback_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "teacher_feedback_revisions"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

-- At commit the mutable aggregate version and immutable revision sequence must
-- agree. Deferred checks allow the command to bump the aggregate and append the
-- matching revision in either order inside one transaction.
CREATE FUNCTION "require_teacher_feedback_revision_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  feedback_uuid UUID;
  feedback_version INTEGER;
  feedback_created_at TIMESTAMPTZ(3);
  feedback_updated_at TIMESTAMPTZ(3);
  revision_count INTEGER;
  first_version INTEGER;
  last_version INTEGER;
  first_confirmed_at TIMESTAMPTZ(3);
  last_confirmed_at TIMESTAMPTZ(3);
BEGIN
  IF TG_TABLE_NAME = 'teacher_feedback' THEN
    feedback_uuid := NEW."id";
  ELSE
    feedback_uuid := NEW."teacher_feedback_id";
  END IF;

  SELECT
    feedback."version",
    feedback."created_at",
    feedback."updated_at"
  INTO
    feedback_version,
    feedback_created_at,
    feedback_updated_at
  FROM "teacher_feedback" AS feedback
  WHERE feedback."id" = feedback_uuid;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    min(revision."version"),
    max(revision."version"),
    min(revision."confirmed_at"),
    max(revision."confirmed_at")
  INTO
    revision_count,
    first_version,
    last_version,
    first_confirmed_at,
    last_confirmed_at
  FROM "teacher_feedback_revisions" AS revision
  WHERE revision."teacher_feedback_id" = feedback_uuid;

  IF revision_count <> feedback_version
    OR first_version <> 1
    OR last_version <> feedback_version THEN
    RAISE EXCEPTION 'teacher feedback % has an inconsistent revision sequence', feedback_uuid
      USING ERRCODE = '23514';
  END IF;

  IF first_confirmed_at IS DISTINCT FROM feedback_created_at
    OR last_confirmed_at IS DISTINCT FROM feedback_updated_at THEN
    RAISE EXCEPTION 'teacher feedback % has inconsistent revision times', feedback_uuid
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "teacher_feedback_revision_consistency"
  AFTER INSERT OR UPDATE ON "teacher_feedback"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_teacher_feedback_revision_consistency"();

CREATE CONSTRAINT TRIGGER "teacher_feedback_revisions_sequence_consistency"
  AFTER INSERT ON "teacher_feedback_revisions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_teacher_feedback_revision_consistency"();
