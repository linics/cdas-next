-- D-031 freezes the execution protocol at publication and scopes each stable
-- submission container to either the whole task (0) or one snapshot phase.
ALTER TABLE "activity_releases"
  ADD COLUMN "execution_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "submissions"
  ADD COLUMN "phase_index" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "submission_working_copies"
  ADD COLUMN "completed_evidence_indexes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "submission_revisions"
  ADD COLUMN "completed_evidence_indexes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "activity_releases"
  ADD CONSTRAINT "activity_releases_execution_version_supported"
    CHECK ("execution_version" IN (0, 1));

ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_phase_index_nonnegative"
    CHECK ("phase_index" >= 0);

DROP INDEX "submissions_release_id_student_id_key";
CREATE UNIQUE INDEX "submissions_release_id_student_id_phase_index_key"
  ON "submissions"("release_id", "student_id", "phase_index");

-- Text is no longer the only valid evidence. The deferred formal-evidence
-- guard below also accepts a READY attachment copied into the revision or a
-- declared checkpoint from the frozen phase definition.
ALTER TABLE "submission_revisions"
  DROP CONSTRAINT "submission_revisions_text_contract",
  ADD CONSTRAINT "submission_revisions_text_length" CHECK (
    char_length("text_evidence") <= 20000
  );

CREATE FUNCTION "assert_submission_phase_scope"(
  release_uuid UUID,
  student_uuid UUID,
  phase_number INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  execution_version_value INTEGER;
  content_value JSONB;
  phase_count INTEGER;
  submission_mode TEXT;
BEGIN
  SELECT release."execution_version", snapshot."content"
  INTO execution_version_value, content_value
  FROM "activity_releases" AS release
  JOIN "activity_release_snapshots" AS snapshot
    ON snapshot."release_id" = release."id"
  WHERE release."id" = release_uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'submission requires a released activity snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF execution_version_value = 0 THEN
    IF phase_number <> 0 THEN
      RAISE EXCEPTION 'whole-task execution only accepts phase 0'
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;

  IF execution_version_value <> 1
    OR content_value -> 'schemaVersion' <> '2'::JSONB
    OR jsonb_typeof(content_value -> 'phases') <> 'array' THEN
    RAISE EXCEPTION 'sequential execution requires a schema v2 phase snapshot'
      USING ERRCODE = '23514';
  END IF;

  phase_count := jsonb_array_length(content_value -> 'phases');
  submission_mode := content_value ->> 'submissionMode';

  IF submission_mode NOT IN ('phased', 'mixed') THEN
    RAISE EXCEPTION 'sequential execution requires phased or mixed mode'
      USING ERRCODE = '23514';
  END IF;

  IF phase_number = 0 THEN
    IF submission_mode <> 'mixed'
      OR EXISTS (
        SELECT 1
        FROM generate_series(1, phase_count) expected_phase
        WHERE NOT EXISTS (
          SELECT 1
          FROM "submissions" AS prerequisite
          WHERE prerequisite."release_id" = release_uuid
            AND prerequisite."student_id" = student_uuid
            AND prerequisite."phase_index" = expected_phase
            AND prerequisite."latest_revision_number" > 0
        )
      ) THEN
      RAISE EXCEPTION 'mixed final submission requires every phase revision'
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;

  IF phase_number < 1 OR phase_number > phase_count THEN
    RAISE EXCEPTION 'submission phase is outside the frozen snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF phase_number > 1 AND NOT EXISTS (
    SELECT 1
    FROM "submissions" AS prerequisite
    WHERE prerequisite."release_id" = release_uuid
      AND prerequisite."student_id" = student_uuid
      AND prerequisite."phase_index" = phase_number - 1
      AND prerequisite."latest_revision_number" > 0
  ) THEN
    RAISE EXCEPTION 'submission phase prerequisite is incomplete'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_submission_container_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'submission containers cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM "assert_submission_phase_scope"(
      NEW."release_id",
      NEW."student_id",
      NEW."phase_index"
    );
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."release_id" IS DISTINCT FROM OLD."release_id"
    OR NEW."student_id" IS DISTINCT FROM OLD."student_id"
    OR NEW."phase_index" IS DISTINCT FROM OLD."phase_index"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'submission identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."latest_revision_number" <> OLD."latest_revision_number"
    AND NEW."latest_revision_number" <> OLD."latest_revision_number" + 1 THEN
    RAISE EXCEPTION 'submission revisions must advance exactly one step'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'submission update time cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER "submissions_container_lifecycle_guard" ON "submissions";
CREATE TRIGGER "submissions_container_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "submissions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_submission_container_lifecycle"();

CREATE FUNCTION "assert_submission_evidence_indexes"(
  submission_uuid UUID,
  evidence_indexes INTEGER[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  phase_number INTEGER;
  content_value JSONB;
  evidence_count INTEGER;
BEGIN
  IF array_position(evidence_indexes, NULL) IS NOT NULL
    OR cardinality(evidence_indexes) <> (
      SELECT count(DISTINCT evidence_index)
      FROM unnest(evidence_indexes) evidence_index
    ) THEN
    RAISE EXCEPTION 'completed evidence indexes must be unique integers'
      USING ERRCODE = '23514';
  END IF;

  SELECT submission."phase_index", snapshot."content"
  INTO phase_number, content_value
  FROM "submissions" AS submission
  JOIN "activity_release_snapshots" AS snapshot
    ON snapshot."release_id" = submission."release_id"
  WHERE submission."id" = submission_uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence indexes require a submission snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF phase_number = 0 THEN
    IF cardinality(evidence_indexes) <> 0 THEN
      RAISE EXCEPTION 'whole-task submissions do not accept phase evidence indexes'
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;

  evidence_count := jsonb_array_length(
    content_value -> 'phases' -> (phase_number - 1) -> 'evidence'
  );

  IF EXISTS (
    SELECT 1
    FROM unnest(evidence_indexes) evidence_index
    WHERE evidence_index < 1 OR evidence_index > evidence_count
  ) THEN
    RAISE EXCEPTION 'completed evidence index is outside the frozen phase'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "enforce_submission_evidence_indexes"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "assert_submission_evidence_indexes"(
    NEW."submission_id",
    NEW."completed_evidence_indexes"
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "submission_working_copies_evidence_indexes_guard"
  BEFORE INSERT OR UPDATE ON "submission_working_copies"
  FOR EACH ROW EXECUTE FUNCTION "enforce_submission_evidence_indexes"();

CREATE TRIGGER "submission_revisions_evidence_indexes_guard"
  BEFORE INSERT ON "submission_revisions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_submission_evidence_indexes"();

-- A consumed working copy and its formal revision must agree on both text and
-- the explicit phase-checkpoint assertions.
CREATE OR REPLACE FUNCTION "enforce_submission_working_copy_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."version" <> 1 THEN
      RAISE EXCEPTION 'submission working copies must start at version 1'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "submission_revisions" AS revision
      WHERE revision."source_working_copy_id" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'consumed working-copy identities cannot be reused'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "submission_revisions" AS revision
      JOIN "submissions" AS submission
        ON submission."id" = revision."submission_id"
      WHERE revision."submission_id" = OLD."submission_id"
        AND revision."source_working_copy_id" = OLD."id"
        AND revision."source_working_version" = OLD."version"
        AND revision."base_revision_number" = OLD."base_revision_number"
        AND revision."text_evidence" = OLD."text_evidence"
        AND revision."completed_evidence_indexes" = OLD."completed_evidence_indexes"
        AND revision."revision_number" = OLD."base_revision_number" + 1
        AND submission."latest_revision_number" = revision."revision_number"
    ) THEN
      RAISE EXCEPTION 'a working copy can only be removed by its exact formal revision'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."submission_id" IS DISTINCT FROM OLD."submission_id"
    OR NEW."base_revision_number" IS DISTINCT FROM OLD."base_revision_number"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'submission working-copy identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'submission working-copy version must advance by one'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'working-copy update time cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "require_submission_revision_working_copy"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "submission_working_copies" AS working_copy
    JOIN "submissions" AS submission
      ON submission."id" = working_copy."submission_id"
    WHERE working_copy."id" = NEW."source_working_copy_id"
      AND working_copy."submission_id" = NEW."submission_id"
      AND working_copy."version" = NEW."source_working_version"
      AND working_copy."base_revision_number" = NEW."base_revision_number"
      AND working_copy."text_evidence" = NEW."text_evidence"
      AND working_copy."completed_evidence_indexes" = NEW."completed_evidence_indexes"
      AND NEW."revision_number" = working_copy."base_revision_number" + 1
      AND submission."latest_revision_number" = NEW."revision_number"
  ) THEN
    RAISE EXCEPTION 'a formal revision must copy one exact saved working-copy version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "require_submission_revision_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  revision_uuid UUID;
BEGIN
  IF TG_TABLE_NAME = 'submission_revisions' THEN
    revision_uuid := NEW."id";
  ELSE
    revision_uuid := NEW."submission_revision_id";
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "submission_revisions" AS revision
    WHERE revision."id" = revision_uuid
      AND (
        "cdas_text_has_visible_content"(revision."text_evidence")
        OR cardinality(revision."completed_evidence_indexes") > 0
        OR EXISTS (
          SELECT 1
          FROM "submission_revision_attachments" AS attachment
          WHERE attachment."submission_revision_id" = revision."id"
        )
      )
  ) THEN
    RAISE EXCEPTION 'formal revision requires text, attachment, or checkpoint evidence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "submission_revisions_require_evidence"
  AFTER INSERT ON "submission_revisions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_submission_revision_evidence"();

CREATE CONSTRAINT TRIGGER "submission_revision_attachments_require_evidence"
  AFTER INSERT ON "submission_revision_attachments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_submission_revision_evidence"();

CREATE OR REPLACE FUNCTION "enforce_activity_release_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'activity releases cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'ACTIVE'
      OR NEW."closed_at" IS NOT NULL
      OR NEW."archived_at" IS NOT NULL
      OR NEW."close_action_intent_id" IS NOT NULL THEN
      RAISE EXCEPTION 'activity releases must start active and unclosed'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."source_draft_id" IS DISTINCT FROM OLD."source_draft_id"
    OR NEW."publisher_id" IS DISTINCT FROM OLD."publisher_id"
    OR NEW."classroom_id" IS DISTINCT FROM OLD."classroom_id"
    OR NEW."action_intent_id" IS DISTINCT FROM OLD."action_intent_id"
    OR NEW."execution_version" IS DISTINCT FROM OLD."execution_version"
    OR NEW."published_at" IS DISTINCT FROM OLD."published_at"
    OR NEW."due_at" IS DISTINCT FROM OLD."due_at" THEN
    RAISE EXCEPTION 'published release identity, execution, and schedule are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF NEW."closed_at" IS DISTINCT FROM OLD."closed_at"
      OR NEW."archived_at" IS DISTINCT FROM OLD."archived_at"
      OR NEW."close_action_intent_id" IS DISTINCT FROM OLD."close_action_intent_id" THEN
      RAISE EXCEPTION 'release close provenance and lifecycle timestamps cannot change in place'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'CLOSED' THEN
    IF OLD."close_action_intent_id" IS NOT NULL
      OR NEW."close_action_intent_id" IS NULL
      OR NEW."closed_at" IS NULL
      OR NEW."closed_at" < OLD."published_at"
      OR NEW."archived_at" IS NOT NULL THEN
      RAISE EXCEPTION 'closing a release requires a valid close intent and time'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" = 'CLOSED' AND NEW."status" = 'ARCHIVED' THEN
    IF NEW."close_action_intent_id" IS DISTINCT FROM OLD."close_action_intent_id"
      OR NEW."closed_at" IS DISTINCT FROM OLD."closed_at"
      OR NEW."archived_at" IS NULL
      OR NEW."archived_at" < OLD."closed_at" THEN
      RAISE EXCEPTION 'archiving must preserve close provenance and time'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid activity release status transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
