-- A Submission is a stable container. Its owner/release cannot be reassigned,
-- and the current formal revision can only advance one step at a time.
ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_updated_after_create" CHECK (
    "updated_at" >= "created_at"
  );

CREATE FUNCTION "enforce_submission_container_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'submission containers cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."release_id" IS DISTINCT FROM OLD."release_id"
    OR NEW."student_id" IS DISTINCT FROM OLD."student_id"
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

CREATE TRIGGER "submissions_container_lifecycle_guard"
  BEFORE UPDATE OR DELETE ON "submissions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_submission_container_lifecycle"();

-- Working-copy UUID + version is the optimistic-concurrency token. Keep its
-- identity/base fixed and require every mutation to consume one version.
CREATE FUNCTION "enforce_submission_working_copy_lifecycle"()
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

CREATE TRIGGER "submission_working_copies_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "submission_working_copies"
  FOR EACH ROW EXECUTE FUNCTION "enforce_submission_working_copy_lifecycle"();

CREATE FUNCTION "require_submission_revision_working_copy"()
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
      AND NEW."revision_number" = working_copy."base_revision_number" + 1
      AND submission."latest_revision_number" = NEW."revision_number"
  ) THEN
    RAISE EXCEPTION 'a formal revision must copy one exact saved working-copy version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "submission_revisions_require_working_copy"
  BEFORE INSERT ON "submission_revisions"
  FOR EACH ROW EXECUTE FUNCTION "require_submission_revision_working_copy"();

-- At commit the latest pointer, immutable revisions, and optional working copy
-- must describe one coherent state. The triggers are deferred so commands may
-- update the pointer before inserting the revision in the same transaction.
CREATE FUNCTION "require_submission_revision_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  submission_uuid UUID;
  latest_number INTEGER;
  revision_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'submissions' THEN
    submission_uuid := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    submission_uuid := OLD."submission_id";
  ELSE
    submission_uuid := NEW."submission_id";
  END IF;

  SELECT submission."latest_revision_number"
  INTO latest_number
  FROM "submissions" AS submission
  WHERE submission."id" = submission_uuid;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*)
  INTO revision_count
  FROM "submission_revisions" AS revision
  WHERE revision."submission_id" = submission_uuid
    AND revision."revision_number" <= latest_number;

  IF revision_count <> latest_number
    OR EXISTS (
      SELECT 1
      FROM "submission_revisions" AS revision
      WHERE revision."submission_id" = submission_uuid
        AND revision."revision_number" > latest_number
    ) THEN
    RAISE EXCEPTION 'submission % has an inconsistent revision sequence', submission_uuid
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "submission_working_copies" AS working_copy
    WHERE working_copy."submission_id" = submission_uuid
      AND working_copy."base_revision_number" <> latest_number
  ) THEN
    RAISE EXCEPTION 'submission % working copy is based on a stale revision', submission_uuid
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "submissions_revision_consistency"
  AFTER INSERT OR UPDATE ON "submissions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_submission_revision_consistency"();

CREATE CONSTRAINT TRIGGER "submission_working_copies_revision_consistency"
  AFTER INSERT OR UPDATE OR DELETE ON "submission_working_copies"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_submission_revision_consistency"();

CREATE CONSTRAINT TRIGGER "submission_revisions_sequence_consistency"
  AFTER INSERT ON "submission_revisions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_submission_revision_consistency"();
