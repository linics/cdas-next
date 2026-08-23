-- A published release must name the one confirmed publish intent that created
-- it. Existing command-created releases can be recovered from their unique
-- successful audit; ambiguous or hand-forged history is not silently repaired.
ALTER TABLE "activity_releases"
  ADD COLUMN "action_intent_id" UUID;

WITH "release_intent_candidates" AS (
  SELECT
    release."id" AS "release_id",
    array_agg(DISTINCT audit."action_intent_id") FILTER (
      WHERE audit."action_intent_id" IS NOT NULL
    ) AS "intent_ids"
  FROM "activity_releases" AS release
  LEFT JOIN "action_audits" AS audit
    ON audit."outcome" = 'SUCCEEDED'
    AND audit."action_name" = 'publish_activity_release'
    AND audit."target_type" = 'ActivityRelease'
    AND audit."target_id" = release."id"
    AND audit."result_resource_id" = release."id"
    AND audit."actor_id" = release."publisher_id"
  GROUP BY release."id"
)
UPDATE "activity_releases" AS release
SET "action_intent_id" = candidates."intent_ids"[1]
FROM "release_intent_candidates" AS candidates
WHERE candidates."release_id" = release."id"
  AND cardinality(candidates."intent_ids") = 1;

DO $$
DECLARE
  invalid_release_id UUID;
BEGIN
  SELECT release."id"
  INTO invalid_release_id
  FROM "activity_releases" AS release
  WHERE release."action_intent_id" IS NULL
  ORDER BY release."id"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'cannot bind activity release % to exactly one successful publish audit', invalid_release_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "activity_releases_action_intent_id_key"
  ON "activity_releases" ("action_intent_id");

ALTER TABLE "activity_releases"
  ALTER COLUMN "action_intent_id" SET NOT NULL,
  ADD CONSTRAINT "activity_releases_action_intent_id_fkey"
    FOREIGN KEY ("action_intent_id") REFERENCES "action_intents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- This is deliberately not a general JSON canonicalizer. Activity snapshot
-- schema v1 contains one integer literal, text scalars, and text arrays, so a
-- fixed field order exactly mirrors canonicalize@4 without inventing another
-- extensible serialization protocol.
CREATE FUNCTION "cdas_activity_content_v1_canonical"(
  title_value TEXT,
  summary_value TEXT,
  learning_objectives_value TEXT[],
  task_instructions_value TEXT,
  evidence_requirements_value TEXT[],
  feedback_criteria_value TEXT[]
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT
    '{"evidenceRequirements":' || array_to_json(evidence_requirements_value)::TEXT
    || ',"feedbackCriteria":' || array_to_json(feedback_criteria_value)::TEXT
    || ',"learningObjectives":' || array_to_json(learning_objectives_value)::TEXT
    || ',"schemaVersion":1'
    || ',"summary":' || to_json(summary_value)::TEXT
    || ',"taskInstructions":' || to_json(task_instructions_value)::TEXT
    || ',"title":' || to_json(title_value)::TEXT
    || '}';
$$;

CREATE FUNCTION "cdas_publish_payload_canonical"(payload_value JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT
    '{"classroomId":' || to_json(payload_value ->> 'classroomId')::TEXT
    || ',"draftId":' || to_json(payload_value ->> 'draftId')::TEXT
    || ',"dueAt":' || CASE
      WHEN payload_value -> 'dueAt' = 'null'::JSONB THEN 'null'
      ELSE to_json(payload_value ->> 'dueAt')::TEXT
    END
    || ',"expectedDraftVersion":' || (payload_value ->> 'expectedDraftVersion')::INTEGER::TEXT
    || '}';
$$;

CREATE FUNCTION "assert_activity_release_integrity"(target_release_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  release_row "activity_releases"%ROWTYPE;
  intent_row "action_intents"%ROWTYPE;
  draft_row "activity_drafts"%ROWTYPE;
  snapshot_row "activity_release_snapshots"%ROWTYPE;
  revision_row "activity_draft_revisions"%ROWTYPE;
  expected_content JSONB;
  expected_content_hash TEXT;
  expected_payload_hash TEXT;
  payload_due_at TIMESTAMPTZ;
  publisher_role "UserRole";
  classroom_manager_id UUID;
  run_actor_id UUID;
  run_status "AgentRunStatus";
BEGIN
  SELECT *
  INTO release_row
  FROM "activity_releases" AS release
  WHERE release."id" = target_release_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'activity release % does not exist', target_release_id
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO intent_row
  FROM "action_intents" AS intent
  WHERE intent."id" = release_row."action_intent_id";

  SELECT *
  INTO draft_row
  FROM "activity_drafts" AS draft
  WHERE draft."id" = release_row."source_draft_id";

  SELECT *
  INTO snapshot_row
  FROM "activity_release_snapshots" AS snapshot
  WHERE snapshot."release_id" = release_row."id";

  IF intent_row."id" IS NULL
    OR draft_row."id" IS NULL
    OR snapshot_row."release_id" IS NULL THEN
    RAISE EXCEPTION 'activity release % requires an intent, sealed draft, and snapshot', target_release_id
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO revision_row
  FROM "activity_draft_revisions" AS revision
  WHERE revision."draft_id" = snapshot_row."source_draft_id"
    AND revision."version" = snapshot_row."source_draft_version";

  IF revision_row."id" IS NULL THEN
    RAISE EXCEPTION 'activity release % requires its exact source revision', target_release_id
      USING ERRCODE = '23514';
  END IF;

  SELECT "role"
  INTO publisher_role
  FROM "app_users"
  WHERE "id" = release_row."publisher_id";

  SELECT "manager_id"
  INTO classroom_manager_id
  FROM "classrooms"
  WHERE "id" = release_row."classroom_id";

  IF publisher_role IS DISTINCT FROM 'TEACHER'
    OR classroom_manager_id IS DISTINCT FROM release_row."publisher_id"
    OR draft_row."owner_id" IS DISTINCT FROM release_row."publisher_id" THEN
    RAISE EXCEPTION 'activity release % publisher does not own its draft and classroom', target_release_id
      USING ERRCODE = '23514';
  END IF;

  IF intent_row."status" <> 'EXECUTED'
    OR intent_row."action_name" <> 'publish_activity_release'
    OR intent_row."target_type" <> 'ActivityDraft'
    OR intent_row."actor_id" IS DISTINCT FROM release_row."publisher_id"
    OR intent_row."decided_by_id" IS DISTINCT FROM release_row."publisher_id"
    OR intent_row."target_id" IS DISTINCT FROM release_row."source_draft_id"
    OR intent_row."expected_version" IS DISTINCT FROM snapshot_row."source_draft_version"
    OR intent_row."executed_at" IS DISTINCT FROM release_row."published_at" THEN
    RAISE EXCEPTION 'activity release % is not backed by its executed publish intent', target_release_id
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(intent_row."payload") <> 'object'
    OR NOT intent_row."payload" ?& ARRAY[
      'classroomId',
      'draftId',
      'dueAt',
      'expectedDraftVersion'
    ]
    OR (
      SELECT count(*)
      FROM jsonb_object_keys(intent_row."payload")
    ) <> 4
    OR jsonb_typeof(intent_row."payload" -> 'classroomId') <> 'string'
    OR jsonb_typeof(intent_row."payload" -> 'draftId') <> 'string'
    OR jsonb_typeof(intent_row."payload" -> 'expectedDraftVersion') <> 'number'
    OR jsonb_typeof(intent_row."payload" -> 'dueAt') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'activity release % publish payload has an invalid shape', target_release_id
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    IF intent_row."payload" -> 'dueAt' = 'null'::JSONB THEN
      payload_due_at := NULL;
    ELSE
      payload_due_at := (intent_row."payload" ->> 'dueAt')::TIMESTAMPTZ;
    END IF;

    IF (intent_row."payload" ->> 'draftId')::UUID IS DISTINCT FROM release_row."source_draft_id"
      OR (intent_row."payload" ->> 'classroomId')::UUID IS DISTINCT FROM release_row."classroom_id"
      OR intent_row."payload" -> 'expectedDraftVersion' IS DISTINCT FROM to_jsonb(snapshot_row."source_draft_version")
      OR payload_due_at IS DISTINCT FROM release_row."due_at" THEN
      RAISE EXCEPTION 'activity release % differs from its confirmed publish payload', target_release_id
        USING ERRCODE = '23514';
    END IF;
  EXCEPTION
    WHEN invalid_text_representation
      OR invalid_datetime_format
      OR numeric_value_out_of_range
      OR datetime_field_overflow THEN
      RAISE EXCEPTION 'activity release % publish payload contains invalid typed values', target_release_id
        USING ERRCODE = '23514';
  END;

  expected_payload_hash := encode(
    sha256(convert_to("cdas_publish_payload_canonical"(intent_row."payload"), 'UTF8')),
    'hex'
  );

  IF intent_row."payload_hash" IS DISTINCT FROM expected_payload_hash THEN
    RAISE EXCEPTION 'activity release % publish payload hash is invalid', target_release_id
      USING ERRCODE = '23514';
  END IF;

  IF draft_row."status" <> 'SEALED'
    OR draft_row."version" IS DISTINCT FROM snapshot_row."source_draft_version"
    OR draft_row."sealed_at" IS DISTINCT FROM release_row."published_at" THEN
    RAISE EXCEPTION 'activity release % source draft is not the exact sealed revision', target_release_id
      USING ERRCODE = '23514';
  END IF;

  expected_content := jsonb_build_object(
    'schemaVersion', 1,
    'title', revision_row."title",
    'summary', revision_row."summary",
    'learningObjectives', to_jsonb(revision_row."learning_objectives"),
    'taskInstructions', revision_row."task_instructions",
    'evidenceRequirements', to_jsonb(revision_row."evidence_requirements"),
    'feedbackCriteria', to_jsonb(revision_row."feedback_criteria")
  );

  expected_content_hash := encode(
    sha256(convert_to(
      "cdas_activity_content_v1_canonical"(
        revision_row."title",
        revision_row."summary",
        revision_row."learning_objectives",
        revision_row."task_instructions",
        revision_row."evidence_requirements",
        revision_row."feedback_criteria"
      ),
      'UTF8'
    )),
    'hex'
  );

  IF snapshot_row."source_draft_id" IS DISTINCT FROM release_row."source_draft_id"
    OR snapshot_row."schema_version" <> 1
    OR snapshot_row."content" IS DISTINCT FROM expected_content
    OR snapshot_row."content_hash" IS DISTINCT FROM expected_content_hash THEN
    RAISE EXCEPTION 'activity release % snapshot is not the canonical source revision', target_release_id
      USING ERRCODE = '23514';
  END IF;

  IF intent_row."agent_run_id" IS NOT NULL THEN
    SELECT run."actor_id", run."status"
    INTO run_actor_id, run_status
    FROM "agent_runs" AS run
    WHERE run."id" = intent_row."agent_run_id";

    IF NOT FOUND
      OR run_actor_id IS DISTINCT FROM release_row."publisher_id"
      OR run_status <> 'SUCCEEDED' THEN
      RAISE EXCEPTION 'activity release % Agent intent requires its succeeded owning run', target_release_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

-- Validate all recovered history before installing forward-only constraints.
DO $$
DECLARE
  release_record RECORD;
  orphan_intent_id UUID;
  orphan_draft_id UUID;
BEGIN
  FOR release_record IN
    SELECT release."id"
    FROM "activity_releases" AS release
    ORDER BY release."id"
  LOOP
    PERFORM "assert_activity_release_integrity"(release_record."id");
  END LOOP;

  SELECT intent."id"
  INTO orphan_intent_id
  FROM "action_intents" AS intent
  LEFT JOIN "activity_releases" AS release
    ON release."action_intent_id" = intent."id"
  WHERE intent."action_name" = 'publish_activity_release'
    AND intent."status" = 'EXECUTED'
    AND release."id" IS NULL
  ORDER BY intent."id"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'executed publish intent % has no activity release', orphan_intent_id
      USING ERRCODE = '23514';
  END IF;

  SELECT draft."id"
  INTO orphan_draft_id
  FROM "activity_drafts" AS draft
  LEFT JOIN "activity_releases" AS release
    ON release."source_draft_id" = draft."id"
  WHERE draft."status" = 'SEALED'
    AND release."id" IS NULL
  ORDER BY draft."id"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'sealed activity draft % has no activity release', orphan_draft_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- The new intent identity is immutable together with the existing release
-- identity and schedule. Lifecycle status still moves only forward.
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
      OR NEW."archived_at" IS NOT NULL THEN
      RAISE EXCEPTION 'activity releases must start active'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."source_draft_id" IS DISTINCT FROM OLD."source_draft_id"
    OR NEW."publisher_id" IS DISTINCT FROM OLD."publisher_id"
    OR NEW."classroom_id" IS DISTINCT FROM OLD."classroom_id"
    OR NEW."action_intent_id" IS DISTINCT FROM OLD."action_intent_id"
    OR NEW."published_at" IS DISTINCT FROM OLD."published_at"
    OR NEW."due_at" IS DISTINCT FROM OLD."due_at" THEN
    RAISE EXCEPTION 'published release identity and schedule are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF NEW."closed_at" IS DISTINCT FROM OLD."closed_at"
      OR NEW."archived_at" IS DISTINCT FROM OLD."archived_at" THEN
      RAISE EXCEPTION 'release lifecycle timestamps cannot change in place'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'ACTIVE' AND NEW."status" = 'CLOSED' THEN
    IF NEW."closed_at" IS NULL
      OR NEW."closed_at" < OLD."published_at"
      OR NEW."archived_at" IS NOT NULL THEN
      RAISE EXCEPTION 'closing a release requires a valid close time'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" = 'CLOSED' AND NEW."status" = 'ARCHIVED' THEN
    IF NEW."closed_at" IS DISTINCT FROM OLD."closed_at"
      OR NEW."archived_at" IS NULL
      OR NEW."archived_at" < OLD."closed_at" THEN
      RAISE EXCEPTION 'archiving must preserve the close time'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid activity release status transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER "activity_releases_require_snapshot" ON "activity_releases";
DROP FUNCTION "require_activity_release_snapshot"();

CREATE FUNCTION "enforce_activity_release_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  release_uuid UUID;
BEGIN
  IF TG_TABLE_NAME = 'activity_releases' THEN
    release_uuid := NEW."id";
  ELSIF TG_TABLE_NAME = 'action_intents' THEN
    SELECT release."id"
    INTO release_uuid
    FROM "activity_releases" AS release
    WHERE release."action_intent_id" = NEW."id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'executed publish intent % requires one activity release', NEW."id"
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT release."id"
    INTO release_uuid
    FROM "activity_releases" AS release
    WHERE release."source_draft_id" = NEW."id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sealed activity draft % requires one activity release', NEW."id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM "assert_activity_release_integrity"(release_uuid);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "activity_releases_integrity"
  AFTER INSERT ON "activity_releases"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "enforce_activity_release_integrity"();

CREATE CONSTRAINT TRIGGER "publish_action_intents_require_release"
  AFTER UPDATE ON "action_intents"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW."status" = 'EXECUTED' AND NEW."action_name" = 'publish_activity_release')
  EXECUTE FUNCTION "enforce_activity_release_integrity"();

CREATE CONSTRAINT TRIGGER "sealed_activity_drafts_require_release"
  AFTER UPDATE ON "activity_drafts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW."status" = 'SEALED')
  EXECUTE FUNCTION "enforce_activity_release_integrity"();
