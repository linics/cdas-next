-- D-035 evidence-bound rubric evaluation is a separate append-only aggregate
-- on the current SubmissionRevision. Formative CONTINUE/REVISE feedback stays
-- on TeacherFeedback; this table never stores scores or stage-unlock state.
CREATE TABLE "teacher_evaluations" (
    "id" UUID NOT NULL,
    "submission_revision_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teacher_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "teacher_evaluation_revisions" (
    "id" UUID NOT NULL,
    "teacher_evaluation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "summary_hash" CHAR(64) NOT NULL,
    "outcomes" JSONB NOT NULL,
    "source" "FeedbackRevisionSource" NOT NULL,
    "confirmed_by_id" UUID NOT NULL,
    "action_intent_id" UUID NOT NULL,
    "agent_run_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_evaluation_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "teacher_evaluations_submission_revision_id_key"
  ON "teacher_evaluations"("submission_revision_id");

CREATE INDEX "teacher_evaluations_teacher_id_updated_at_idx"
  ON "teacher_evaluations"("teacher_id", "updated_at");

CREATE UNIQUE INDEX "teacher_evaluation_revisions_action_intent_id_key"
  ON "teacher_evaluation_revisions"("action_intent_id");

CREATE UNIQUE INDEX "teacher_evaluation_revisions_teacher_evaluation_id_version_key"
  ON "teacher_evaluation_revisions"("teacher_evaluation_id", "version");

CREATE INDEX "teacher_evaluation_revisions_agent_run_id_idx"
  ON "teacher_evaluation_revisions"("agent_run_id");

ALTER TABLE "teacher_evaluations"
  ADD CONSTRAINT "teacher_evaluations_submission_revision_id_fkey"
  FOREIGN KEY ("submission_revision_id") REFERENCES "submission_revisions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_evaluations"
  ADD CONSTRAINT "teacher_evaluations_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "app_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_evaluation_revisions"
  ADD CONSTRAINT "teacher_evaluation_revisions_teacher_evaluation_id_fkey"
  FOREIGN KEY ("teacher_evaluation_id") REFERENCES "teacher_evaluations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_evaluation_revisions"
  ADD CONSTRAINT "teacher_evaluation_revisions_confirmed_by_id_fkey"
  FOREIGN KEY ("confirmed_by_id") REFERENCES "app_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_evaluation_revisions"
  ADD CONSTRAINT "teacher_evaluation_revisions_action_intent_id_fkey"
  FOREIGN KEY ("action_intent_id") REFERENCES "action_intents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_evaluation_revisions"
  ADD CONSTRAINT "teacher_evaluation_revisions_agent_run_id_fkey"
  FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_evaluations"
  ADD CONSTRAINT "teacher_evaluations_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "teacher_evaluations_updated_after_create" CHECK (
    "updated_at" >= "created_at"
  );

ALTER TABLE "teacher_evaluation_revisions"
  ADD CONSTRAINT "teacher_evaluation_revisions_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "teacher_evaluation_revisions_summary_visible" CHECK (
    "cdas_text_has_visible_content"("summary")
  ),
  ADD CONSTRAINT "teacher_evaluation_revisions_summary_bounded" CHECK (
    char_length("summary") <= 10000
  ),
  ADD CONSTRAINT "teacher_evaluation_revisions_hash_format" CHECK (
    "summary_hash" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "teacher_evaluation_revisions_outcomes_is_array" CHECK (
    jsonb_typeof("outcomes") = 'array'
    AND jsonb_array_length("outcomes") BETWEEN 4 AND 8
  ),
  ADD CONSTRAINT "teacher_evaluation_revisions_source_provenance" CHECK (
    ("source" = 'MANUAL' AND "agent_run_id" IS NULL)
    OR ("source" = 'AI_ASSISTED' AND "agent_run_id" IS NOT NULL)
  );

CREATE FUNCTION "assert_teacher_evaluation_target_current"(
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
    RAISE EXCEPTION 'teacher evaluation target does not exist'
      USING ERRCODE = '23514';
  END IF;

  IF submitted_revision_number <> current_revision_number THEN
    RAISE EXCEPTION 'teacher evaluation must target the current submission revision'
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

CREATE FUNCTION "assert_teacher_evaluation_outcomes"(
  target_submission_revision_id UUID,
  outcomes JSONB
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_schema_version INTEGER;
  snapshot_content JSONB;
  dimensions JSONB;
  revision_text TEXT;
  completed_indexes INTEGER[];
  outcome_count INTEGER;
  dimension_count INTEGER;
  outcome JSONB;
  dimension JSONB;
  citations JSONB;
  citation JSONB;
  citation_count INTEGER;
  distinct_citation_count INTEGER;
  outcome_index INTEGER;
  evidence_index INTEGER;
  cited_attachment_id UUID;
  status TEXT;
BEGIN
  SELECT
    snapshot."schema_version",
    snapshot."content",
    revision."text_evidence",
    revision."completed_evidence_indexes"
  INTO
    snapshot_schema_version,
    snapshot_content,
    revision_text,
    completed_indexes
  FROM "submission_revisions" AS revision
  JOIN "submissions" AS submission
    ON submission."id" = revision."submission_id"
  JOIN "activity_release_snapshots" AS snapshot
    ON snapshot."release_id" = submission."release_id"
  WHERE revision."id" = target_submission_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'teacher evaluation target does not exist'
      USING ERRCODE = '23514';
  END IF;

  IF snapshot_schema_version <> 2
    OR snapshot_content -> 'schemaVersion' <> '2'::JSONB THEN
    RAISE EXCEPTION 'teacher evaluation requires a schema v2 rubric'
      USING ERRCODE = '23514';
  END IF;

  dimensions := snapshot_content -> 'rubricDimensions';
  IF jsonb_typeof(outcomes) <> 'array'
    OR jsonb_typeof(dimensions) <> 'array' THEN
    RAISE EXCEPTION 'teacher evaluation outcomes must cover the frozen rubric'
      USING ERRCODE = '23514';
  END IF;

  outcome_count := jsonb_array_length(outcomes);
  dimension_count := jsonb_array_length(dimensions);
  IF dimension_count < 4
    OR dimension_count > 8
    OR outcome_count <> dimension_count THEN
    RAISE EXCEPTION 'teacher evaluation must cover every frozen rubric dimension'
      USING ERRCODE = '23514';
  END IF;

  FOR outcome_index IN 0 .. outcome_count - 1 LOOP
    outcome := outcomes -> outcome_index;
    dimension := dimensions -> outcome_index;
    IF jsonb_typeof(outcome) <> 'object'
      OR jsonb_typeof(dimension) <> 'object'
      OR outcome -> 'dimensionIndex' IS DISTINCT FROM to_jsonb(outcome_index + 1)
      OR outcome ->> 'dimensionName' IS DISTINCT FROM dimension ->> 'name' THEN
      RAISE EXCEPTION 'teacher evaluation outcome must match the frozen snapshot rubric'
        USING ERRCODE = '23514';
    END IF;

    status := outcome ->> 'status';
    citations := outcome -> 'citations';
    IF jsonb_typeof(citations) <> 'array' THEN
      RAISE EXCEPTION 'teacher evaluation citations must be an array'
        USING ERRCODE = '23514';
    END IF;
    citation_count := jsonb_array_length(citations);

    IF status = 'LEVEL' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(outcome)) <> 5
        OR NOT outcome ?& ARRAY['dimensionIndex', 'dimensionName', 'status', 'level', 'citations']
        OR outcome ->> 'level' NOT IN ('excellent', 'good', 'pass', 'improve')
        OR citation_count < 1
        OR citation_count > 5 THEN
        RAISE EXCEPTION 'levelled evaluation outcomes require a rubric level and 1 to 5 citations'
          USING ERRCODE = '23514';
      END IF;
    ELSIF status = 'INSUFFICIENT_EVIDENCE' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(outcome)) <> 4
        OR NOT outcome ?& ARRAY['dimensionIndex', 'dimensionName', 'status', 'citations']
        OR citation_count <> 0 THEN
        RAISE EXCEPTION 'insufficient-evidence outcomes cannot carry a level or citations'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'teacher evaluation outcome status is not allowed'
        USING ERRCODE = '23514';
    END IF;

    SELECT
      count(*),
      count(DISTINCT citation_key)
    INTO
      citation_count,
      distinct_citation_count
    FROM (
      SELECT
        CASE
          WHEN jsonb_typeof(item.value) <> 'object' THEN NULL
          WHEN item.value ->> 'kind' = 'text'
            AND (SELECT count(*) FROM jsonb_object_keys(item.value)) = 1 THEN 'text'
          WHEN item.value ->> 'kind' = 'attachment'
            AND (SELECT count(*) FROM jsonb_object_keys(item.value)) = 2
            AND item.value ? 'attachmentId' THEN 'attachment:' || (item.value ->> 'attachmentId')
          WHEN item.value ->> 'kind' = 'checkpoint'
            AND (SELECT count(*) FROM jsonb_object_keys(item.value)) = 2
            AND item.value ? 'evidenceIndex' THEN 'checkpoint:' || (item.value ->> 'evidenceIndex')
          ELSE NULL
        END AS citation_key
      FROM jsonb_array_elements(citations) WITH ORDINALITY AS item(value, ordinality)
    ) AS citation_keys;

    IF status = 'LEVEL'
      AND (citation_count <> jsonb_array_length(citations)
        OR distinct_citation_count <> citation_count
        OR citation_count = 0) THEN
      RAISE EXCEPTION 'teacher evaluation citations must be unique and well-formed'
        USING ERRCODE = '23514';
    END IF;

    IF status = 'LEVEL' THEN
      FOR citation IN SELECT value FROM jsonb_array_elements(citations)
      LOOP
        IF citation ->> 'kind' = 'text' THEN
          IF NOT "cdas_text_has_visible_content"(revision_text) THEN
            RAISE EXCEPTION 'text citations require visible text evidence on the current revision'
              USING ERRCODE = '23514';
          END IF;
        ELSIF citation ->> 'kind' = 'attachment' THEN
          BEGIN
            cited_attachment_id := (citation ->> 'attachmentId')::UUID;
          EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'attachment citations must name a ready revision attachment'
              USING ERRCODE = '23514';
          END;
          IF NOT EXISTS (
            SELECT 1
            FROM "submission_revision_attachments" AS link
            JOIN "submission_attachments" AS attachment
              ON attachment."id" = link."attachment_id"
            WHERE link."submission_revision_id" = target_submission_revision_id
              AND attachment."id" = cited_attachment_id
              AND attachment."status" = 'READY'
          ) THEN
            RAISE EXCEPTION 'attachment citations must name a ready revision attachment'
              USING ERRCODE = '23514';
          END IF;
        ELSIF citation ->> 'kind' = 'checkpoint' THEN
          IF jsonb_typeof(citation -> 'evidenceIndex') <> 'number'
            OR (citation ->> 'evidenceIndex') !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'checkpoint citations must name a completed evidence index'
              USING ERRCODE = '23514';
          END IF;
          evidence_index := (citation ->> 'evidenceIndex')::INTEGER;
          IF evidence_index IS NULL
            OR NOT evidence_index = ANY (completed_indexes) THEN
            RAISE EXCEPTION 'checkpoint citations must name a completed evidence index'
              USING ERRCODE = '23514';
          END IF;
        ELSE
          RAISE EXCEPTION 'teacher evaluation citation kind is not allowed'
            USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION "enforce_teacher_evaluation_container_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'teacher evaluation containers cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'teacher evaluation must start at version 1'
        USING ERRCODE = '23514';
    END IF;

    PERFORM "assert_teacher_evaluation_target_current"(
      NEW."submission_revision_id",
      NEW."teacher_id"
    );
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."submission_revision_id" IS DISTINCT FROM OLD."submission_revision_id"
    OR NEW."teacher_id" IS DISTINCT FROM OLD."teacher_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'teacher evaluation identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'teacher evaluation version must advance by one'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'teacher evaluation update time cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  PERFORM "assert_teacher_evaluation_target_current"(
    NEW."submission_revision_id",
    NEW."teacher_id"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "teacher_evaluation_container_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "teacher_evaluations"
  FOR EACH ROW EXECUTE FUNCTION "enforce_teacher_evaluation_container_lifecycle"();

CREATE FUNCTION "enforce_teacher_evaluation_revision_contract"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evaluation_teacher_id UUID;
  evaluation_version INTEGER;
  evaluation_created_at TIMESTAMPTZ(3);
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
    evaluation."teacher_id",
    evaluation."version",
    evaluation."created_at",
    evaluation."submission_revision_id",
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
    evaluation_teacher_id,
    evaluation_version,
    evaluation_created_at,
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
  FROM "teacher_evaluations" AS evaluation
  JOIN "submission_revisions" AS revision
    ON revision."id" = evaluation."submission_revision_id"
  JOIN "action_intents" AS intent
    ON intent."id" = NEW."action_intent_id"
  WHERE evaluation."id" = NEW."teacher_evaluation_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evaluation revision requires an evaluation container and action intent'
      USING ERRCODE = '23514';
  END IF;

  PERFORM "assert_teacher_evaluation_target_current"(
    target_submission_revision_id,
    evaluation_teacher_id
  );

  IF NEW."version" <> evaluation_version
    OR NEW."confirmed_by_id" <> evaluation_teacher_id THEN
    RAISE EXCEPTION 'evaluation revision version or confirmer does not match its container'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."confirmed_at" < target_submitted_at
    OR NEW."confirmed_at" < evaluation_created_at
    OR NEW."confirmed_at" IS DISTINCT FROM intent_executed_at THEN
    RAISE EXCEPTION 'evaluation confirmation time is inconsistent'
      USING ERRCODE = '23514';
  END IF;

  IF encode(sha256(convert_to(NEW."summary", 'UTF8')), 'hex') IS DISTINCT FROM NEW."summary_hash" THEN
    RAISE EXCEPTION 'evaluation summary hash does not match its summary'
      USING ERRCODE = '23514';
  END IF;

  IF intent_status <> 'EXECUTED'
    OR intent_actor_id <> evaluation_teacher_id
    OR intent_decided_by_id <> evaluation_teacher_id
    OR intent_action_name <> 'save_teacher_evaluation'
    OR intent_target_type <> 'Submission'
    OR intent_target_id <> target_submission_id
    OR intent_expected_version <> target_revision_number
    OR intent_agent_run_id IS DISTINCT FROM NEW."agent_run_id" THEN
    RAISE EXCEPTION 'evaluation revision is not backed by its confirmed action intent'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(intent_payload) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(intent_payload)) <> 8
    OR NOT intent_payload ?& ARRAY[
      'schemaVersion', 'submissionId', 'submissionRevisionId',
      'expectedSubmissionRevisionNumber', 'expectedEvaluationVersion',
      'summary', 'outcomes', 'suggestionAgentRunId'
    ]
    OR intent_payload ->> 'schemaVersion' IS DISTINCT FROM '1'
    OR intent_payload ->> 'submissionId' IS DISTINCT FROM target_submission_id::text
    OR intent_payload ->> 'submissionRevisionId' IS DISTINCT FROM target_submission_revision_id::text
    OR (intent_payload ->> 'expectedSubmissionRevisionNumber')::INTEGER IS DISTINCT FROM target_revision_number
    OR (intent_payload ->> 'expectedEvaluationVersion')::INTEGER IS DISTINCT FROM NEW."version" - 1
    OR intent_payload ->> 'summary' IS DISTINCT FROM NEW."summary"
    OR intent_payload -> 'outcomes' IS DISTINCT FROM NEW."outcomes"
    OR intent_payload ->> 'suggestionAgentRunId' IS DISTINCT FROM NEW."agent_run_id"::text THEN
    RAISE EXCEPTION 'evaluation revision differs from its confirmed payload'
      USING ERRCODE = '23514';
  END IF;

  PERFORM "assert_teacher_evaluation_outcomes"(
    target_submission_revision_id,
    NEW."outcomes"
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER "teacher_evaluation_revisions_contract_guard"
  BEFORE INSERT ON "teacher_evaluation_revisions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_teacher_evaluation_revision_contract"();

CREATE TRIGGER "teacher_evaluation_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "teacher_evaluation_revisions"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

CREATE FUNCTION "require_teacher_evaluation_revision_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evaluation_uuid UUID;
  evaluation_version INTEGER;
  evaluation_created_at TIMESTAMPTZ(3);
  evaluation_updated_at TIMESTAMPTZ(3);
  revision_count INTEGER;
  first_version INTEGER;
  last_version INTEGER;
  first_confirmed_at TIMESTAMPTZ(3);
  last_confirmed_at TIMESTAMPTZ(3);
BEGIN
  IF TG_TABLE_NAME = 'teacher_evaluations' THEN
    evaluation_uuid := NEW."id";
  ELSE
    evaluation_uuid := NEW."teacher_evaluation_id";
  END IF;

  SELECT
    evaluation."version",
    evaluation."created_at",
    evaluation."updated_at"
  INTO
    evaluation_version,
    evaluation_created_at,
    evaluation_updated_at
  FROM "teacher_evaluations" AS evaluation
  WHERE evaluation."id" = evaluation_uuid;

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
  FROM "teacher_evaluation_revisions" AS revision
  WHERE revision."teacher_evaluation_id" = evaluation_uuid;

  IF revision_count <> evaluation_version
    OR first_version <> 1
    OR last_version <> evaluation_version THEN
    RAISE EXCEPTION 'teacher evaluation % has an inconsistent revision sequence', evaluation_uuid
      USING ERRCODE = '23514';
  END IF;

  IF first_confirmed_at IS DISTINCT FROM evaluation_created_at
    OR last_confirmed_at IS DISTINCT FROM evaluation_updated_at THEN
    RAISE EXCEPTION 'teacher evaluation % has inconsistent revision times', evaluation_uuid
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "teacher_evaluation_revision_consistency"
  AFTER INSERT OR UPDATE ON "teacher_evaluations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_teacher_evaluation_revision_consistency"();

CREATE CONSTRAINT TRIGGER "teacher_evaluation_revisions_sequence_consistency"
  AFTER INSERT ON "teacher_evaluation_revisions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_teacher_evaluation_revision_consistency"();
