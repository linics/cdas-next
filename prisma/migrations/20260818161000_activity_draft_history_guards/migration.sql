-- ActivityDraft is the mutable head of an append-only revision stream. The
-- database keeps the head and its current immutable revision in lockstep so a
-- caller cannot rewrite content or advance a version without preserving the
-- exact historical row.
ALTER TABLE "activity_drafts"
  ADD CONSTRAINT "activity_drafts_updated_after_create" CHECK (
    "updated_at" >= "created_at"
  );

ALTER TABLE "activity_draft_revisions"
  ADD CONSTRAINT "activity_draft_revisions_source_provenance" CHECK (
    (
      "source" IN ('MANUAL', 'RESTORE')
      AND "agent_run_id" IS NULL
    )
    OR (
      "source" = 'AGENT'
      AND "agent_run_id" IS NOT NULL
    )
  );

CREATE FUNCTION "enforce_activity_draft_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'activity draft history cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."version" <> 1
      OR NEW."status" NOT IN ('EDITING', 'READY_FOR_PREVIEW')
      OR NEW."sealed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'activity drafts must start at version 1 and remain unsealed'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_id" IS DISTINCT FROM OLD."owner_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'activity draft identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" = 'SEALED' THEN
    RAISE EXCEPTION 'sealed activity drafts cannot be changed'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'activity draft update time cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  -- Publication seals the already-reviewed READY revision without creating a
  -- new content version. No content or ownership field may hitchhike on it.
  IF OLD."status" = 'READY_FOR_PREVIEW' AND NEW."status" = 'SEALED' THEN
    IF NEW."version" IS DISTINCT FROM OLD."version"
      OR NEW."title" IS DISTINCT FROM OLD."title"
      OR NEW."summary" IS DISTINCT FROM OLD."summary"
      OR NEW."learning_objectives" IS DISTINCT FROM OLD."learning_objectives"
      OR NEW."task_instructions" IS DISTINCT FROM OLD."task_instructions"
      OR NEW."evidence_requirements" IS DISTINCT FROM OLD."evidence_requirements"
      OR NEW."feedback_criteria" IS DISTINCT FROM OLD."feedback_criteria"
      OR NEW."sealed_at" IS NULL THEN
      RAISE EXCEPTION 'publication may only seal the unchanged ready revision'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" = 'SEALED' OR NEW."sealed_at" IS NOT NULL THEN
    RAISE EXCEPTION 'only a ready draft can be sealed for publication'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'activity draft versions must advance exactly one step'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "activity_drafts_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "activity_drafts"
  FOR EACH ROW EXECUTE FUNCTION "enforce_activity_draft_lifecycle"();

-- Agent-authored revisions must reference a live or successfully completed run
-- owned by the same teacher. Manual and restore revisions carry no AgentRun.
CREATE FUNCTION "enforce_activity_draft_revision_provenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  draft_owner_id UUID;
  draft_created_at TIMESTAMPTZ;
BEGIN
  SELECT draft."owner_id", draft."created_at"
  INTO draft_owner_id, draft_created_at
  FROM "activity_drafts" AS draft
  WHERE draft."id" = NEW."draft_id";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW."created_at" < draft_created_at THEN
    RAISE EXCEPTION 'activity draft revision cannot predate its draft'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."source" = 'AGENT' AND NOT EXISTS (
    SELECT 1
    FROM "agent_runs" AS agent_run
    WHERE agent_run."id" = NEW."agent_run_id"
      AND agent_run."actor_id" = draft_owner_id
      AND agent_run."status" IN ('RUNNING', 'SUCCEEDED')
  ) THEN
    RAISE EXCEPTION 'agent revision requires a valid run owned by the draft teacher'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "activity_draft_revisions_provenance_guard"
  BEFORE INSERT ON "activity_draft_revisions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_activity_draft_revision_provenance"();

-- Deferred checks let one transaction update the mutable head and append its
-- exact revision in either statement order. At commit, versions must be dense
-- from 1..head.version and the current row must equal that version's revision.
CREATE FUNCTION "require_activity_draft_revision_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  draft_uuid UUID;
  draft_version INTEGER;
  revision_count INTEGER;
  current_revision "activity_draft_revisions"%ROWTYPE;
  current_draft "activity_drafts"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'activity_drafts' THEN
    draft_uuid := NEW."id";
  ELSE
    draft_uuid := NEW."draft_id";
  END IF;

  SELECT *
  INTO current_draft
  FROM "activity_drafts" AS draft
  WHERE draft."id" = draft_uuid;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  draft_version := current_draft."version";

  SELECT count(*)
  INTO revision_count
  FROM "activity_draft_revisions" AS revision
  WHERE revision."draft_id" = draft_uuid
    AND revision."version" <= draft_version;

  IF revision_count <> draft_version
    OR EXISTS (
      SELECT 1
      FROM "activity_draft_revisions" AS revision
      WHERE revision."draft_id" = draft_uuid
        AND revision."version" > draft_version
    ) THEN
    RAISE EXCEPTION 'activity draft % has an inconsistent revision sequence', draft_uuid
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO current_revision
  FROM "activity_draft_revisions" AS revision
  WHERE revision."draft_id" = draft_uuid
    AND revision."version" = draft_version;

  IF NOT FOUND
    OR current_draft."title" IS DISTINCT FROM current_revision."title"
    OR current_draft."summary" IS DISTINCT FROM current_revision."summary"
    OR current_draft."learning_objectives" IS DISTINCT FROM current_revision."learning_objectives"
    OR current_draft."task_instructions" IS DISTINCT FROM current_revision."task_instructions"
    OR current_draft."evidence_requirements" IS DISTINCT FROM current_revision."evidence_requirements"
    OR current_draft."feedback_criteria" IS DISTINCT FROM current_revision."feedback_criteria" THEN
    RAISE EXCEPTION 'activity draft % does not match its current revision', draft_uuid
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "activity_drafts_revision_consistency"
  AFTER INSERT OR UPDATE ON "activity_drafts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_activity_draft_revision_consistency"();

CREATE CONSTRAINT TRIGGER "activity_draft_revisions_head_consistency"
  AFTER INSERT ON "activity_draft_revisions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_activity_draft_revision_consistency"();
