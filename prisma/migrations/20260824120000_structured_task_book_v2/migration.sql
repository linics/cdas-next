-- v2 adds a complete structured task book beside the v1 scalar projection.
-- Existing history deliberately remains schema v1 and keeps its old hashes.
ALTER TABLE "activity_drafts"
  ADD COLUMN "schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "task_book" JSONB;

ALTER TABLE "activity_draft_revisions"
  ADD COLUMN "schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "task_book" JSONB;

CREATE FUNCTION "cdas_activity_task_book_v2_is_valid"(task_book JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  stage TEXT;
  grade_number INTEGER;
  main_discipline TEXT;
  assignment_type TEXT;
  assignment_subtype JSONB;
BEGIN
  IF jsonb_typeof(task_book) <> 'object'
    OR NOT task_book ?& ARRAY[
      'schemaVersion', 'title', 'topic', 'summary', 'schoolStage', 'grade',
      'mainDisciplineCode', 'integratedDisciplineCodes', 'crossDisciplinaryConceptCodes',
      'assignmentType', 'assignmentSubtype', 'inquiryDepth', 'submissionMode',
      'durationWeeks', 'backgroundSetting', 'objectiveKnowledge', 'objectiveProcess',
      'objectiveEmotion', 'learningObjectives', 'taskInstructions',
      'evidenceRequirements', 'feedbackCriteria', 'phases', 'rubricDimensions'
    ]
    OR (SELECT count(*) FROM jsonb_object_keys(task_book)) <> 24
    OR task_book -> 'schemaVersion' <> '2'::JSONB
    OR jsonb_typeof(task_book -> 'grade') <> 'number'
    OR jsonb_typeof(task_book -> 'durationWeeks') <> 'number'
    OR (task_book ->> 'grade') !~ '^[0-9]+$'
    OR (task_book ->> 'durationWeeks') !~ '^[0-9]+$'
    OR EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'title', 'topic', 'summary', 'schoolStage', 'mainDisciplineCode',
        'assignmentType', 'inquiryDepth', 'submissionMode', 'backgroundSetting',
        'objectiveKnowledge', 'objectiveProcess', 'objectiveEmotion', 'taskInstructions'
      ]) AS key_name
      WHERE jsonb_typeof(task_book -> key_name) <> 'string'
        OR btrim(task_book ->> key_name) = ''
    )
    OR jsonb_typeof(task_book -> 'integratedDisciplineCodes') <> 'array'
    OR jsonb_typeof(task_book -> 'crossDisciplinaryConceptCodes') <> 'array'
    OR jsonb_typeof(task_book -> 'learningObjectives') <> 'array'
    OR jsonb_typeof(task_book -> 'evidenceRequirements') <> 'array'
    OR jsonb_typeof(task_book -> 'feedbackCriteria') <> 'array'
    OR jsonb_typeof(task_book -> 'phases') <> 'array'
    OR jsonb_typeof(task_book -> 'rubricDimensions') <> 'array' THEN
    RETURN FALSE;
  END IF;

  stage := task_book ->> 'schoolStage';
  grade_number := (task_book ->> 'grade')::INTEGER;
  main_discipline := task_book ->> 'mainDisciplineCode';
  assignment_type := task_book ->> 'assignmentType';
  assignment_subtype := task_book -> 'assignmentSubtype';

  IF stage NOT IN ('PRIMARY', 'MIDDLE')
    OR grade_number NOT BETWEEN 1 AND 9
    OR (stage = 'PRIMARY' AND grade_number > 6)
    OR (stage = 'MIDDLE' AND grade_number < 7)
    OR (task_book ->> 'durationWeeks')::INTEGER NOT BETWEEN 1 AND 16
    OR task_book ->> 'inquiryDepth' NOT IN ('basic', 'intermediate', 'deep')
    OR task_book ->> 'submissionMode' NOT IN ('phased', 'once', 'mixed')
    OR assignment_type NOT IN ('practical', 'inquiry', 'project')
    OR (stage = 'PRIMARY' AND main_discipline NOT IN ('politics', 'chinese', 'math', 'english', 'science', 'infoTech', 'labor', 'arts', 'sports', 'integrated'))
    OR (stage = 'MIDDLE' AND main_discipline NOT IN ('politics', 'chinese', 'math', 'english', 'history', 'geography', 'physics', 'chemistry', 'biology', 'infoTech', 'labor', 'arts', 'sports', 'integrated'))
    OR (assignment_type = 'project' AND assignment_subtype <> 'null'::JSONB)
    OR (assignment_type = 'practical' AND (jsonb_typeof(assignment_subtype) <> 'string' OR task_book ->> 'assignmentSubtype' NOT IN ('visit', 'simulation', 'observation')))
    OR (assignment_type = 'inquiry' AND (jsonb_typeof(assignment_subtype) <> 'string' OR task_book ->> 'assignmentSubtype' NOT IN ('literature', 'survey', 'experiment'))) THEN
    RETURN FALSE;
  END IF;

  IF jsonb_array_length(task_book -> 'integratedDisciplineCodes') NOT BETWEEN 1 AND 14
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(task_book -> 'integratedDisciplineCodes') item WHERE jsonb_typeof(item) <> 'string')
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(task_book -> 'integratedDisciplineCodes') code
      WHERE code = main_discipline
        OR (stage = 'PRIMARY' AND code NOT IN ('politics', 'chinese', 'math', 'english', 'science', 'infoTech', 'labor', 'arts', 'sports', 'integrated'))
        OR (stage = 'MIDDLE' AND code NOT IN ('politics', 'chinese', 'math', 'english', 'history', 'geography', 'physics', 'chemistry', 'biology', 'infoTech', 'labor', 'arts', 'sports', 'integrated'))
    )
    OR (SELECT count(*) FROM jsonb_array_elements_text(task_book -> 'integratedDisciplineCodes')) <>
       (SELECT count(DISTINCT code) FROM jsonb_array_elements_text(task_book -> 'integratedDisciplineCodes') code)
    OR jsonb_array_length(task_book -> 'crossDisciplinaryConceptCodes') > 2
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(task_book -> 'crossDisciplinaryConceptCodes') code
      WHERE code NOT IN ('matter_energy', 'structure_function', 'system_model', 'stability_change')
    )
    OR (SELECT count(*) FROM jsonb_array_elements_text(task_book -> 'crossDisciplinaryConceptCodes')) <>
       (SELECT count(DISTINCT code) FROM jsonb_array_elements_text(task_book -> 'crossDisciplinaryConceptCodes') code) THEN
    RETURN FALSE;
  END IF;

  IF jsonb_array_length(task_book -> 'learningObjectives') NOT BETWEEN 1 AND 8
    OR jsonb_array_length(task_book -> 'evidenceRequirements') NOT BETWEEN 1 AND 16
    OR jsonb_array_length(task_book -> 'feedbackCriteria') NOT BETWEEN 1 AND 8
    OR EXISTS (
      SELECT 1 FROM unnest(ARRAY['learningObjectives', 'evidenceRequirements', 'feedbackCriteria']) array_key,
        LATERAL jsonb_array_elements(task_book -> array_key) item
      WHERE jsonb_typeof(item) <> 'string' OR btrim(item #>> '{}') = ''
    ) THEN
    RETURN FALSE;
  END IF;

  IF jsonb_array_length(task_book -> 'phases') NOT BETWEEN 3 AND 4
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(task_book -> 'phases') phase
      WHERE jsonb_typeof(phase) <> 'object'
        OR NOT phase ?& ARRAY['name', 'action', 'context', 'support', 'evidence', 'evaluationFocus', 'suggestedLessons']
        OR (SELECT count(*) FROM jsonb_object_keys(phase)) <> 7
        OR EXISTS (
          SELECT 1 FROM unnest(ARRAY['name', 'action', 'context', 'support', 'evaluationFocus']) phase_key
          WHERE jsonb_typeof(phase -> phase_key) <> 'string' OR btrim(phase ->> phase_key) = ''
        )
        OR jsonb_typeof(phase -> 'suggestedLessons') <> 'number'
        OR (phase ->> 'suggestedLessons') !~ '^[0-9]+$'
        OR (phase ->> 'suggestedLessons')::INTEGER NOT BETWEEN 1 AND 16
        OR jsonb_typeof(phase -> 'evidence') <> 'array'
        OR jsonb_array_length(phase -> 'evidence') NOT BETWEEN 1 AND 4
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(phase -> 'evidence') evidence
          WHERE jsonb_typeof(evidence) <> 'object'
            OR NOT evidence ?& ARRAY['type', 'description']
            OR (SELECT count(*) FROM jsonb_object_keys(evidence)) <> 2
            OR jsonb_typeof(evidence -> 'type') <> 'string'
            OR evidence ->> 'type' NOT IN ('text', 'document', 'image', 'video', 'confirm', 'link')
            OR jsonb_typeof(evidence -> 'description') <> 'string'
            OR btrim(evidence ->> 'description') = ''
        )
    ) THEN
    RETURN FALSE;
  END IF;

  IF jsonb_array_length(task_book -> 'rubricDimensions') NOT BETWEEN 4 AND 8
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(task_book -> 'rubricDimensions') dimension
      WHERE jsonb_typeof(dimension) <> 'object'
        OR NOT dimension ?& ARRAY['name', 'excellent', 'good', 'pass', 'improve']
        OR (SELECT count(*) FROM jsonb_object_keys(dimension)) <> 5
        OR EXISTS (
          SELECT 1 FROM unnest(ARRAY['name', 'excellent', 'good', 'pass', 'improve']) dimension_key
          WHERE jsonb_typeof(dimension -> dimension_key) <> 'string' OR btrim(dimension ->> dimension_key) = ''
        )
    ) THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

ALTER TABLE "activity_drafts"
  ADD CONSTRAINT "activity_drafts_task_book_version" CHECK (
    ("schema_version" = 1 AND "task_book" IS NULL)
    OR (
      "schema_version" = 2
      AND "cdas_activity_task_book_v2_is_valid"("task_book")
      AND "task_book" ->> 'title' = "title"
      AND "task_book" ->> 'summary' = "summary"
      AND "task_book" -> 'learningObjectives' = to_jsonb("learning_objectives")
      AND "task_book" ->> 'taskInstructions' = "task_instructions"
      AND "task_book" -> 'evidenceRequirements' = to_jsonb("evidence_requirements")
      AND "task_book" -> 'feedbackCriteria' = to_jsonb("feedback_criteria")
    )
  );

ALTER TABLE "activity_draft_revisions"
  ADD CONSTRAINT "activity_draft_revisions_task_book_version" CHECK (
    ("schema_version" = 1 AND "task_book" IS NULL)
    OR (
      "schema_version" = 2
      AND "cdas_activity_task_book_v2_is_valid"("task_book")
      AND "task_book" ->> 'title' = "title"
      AND "task_book" ->> 'summary' = "summary"
      AND "task_book" -> 'learningObjectives' = to_jsonb("learning_objectives")
      AND "task_book" ->> 'taskInstructions' = "task_instructions"
      AND "task_book" -> 'evidenceRequirements' = to_jsonb("evidence_requirements")
      AND "task_book" -> 'feedbackCriteria' = to_jsonb("feedback_criteria")
    )
  );

-- Publication must not use a schema change to alter an already reviewed head.
CREATE OR REPLACE FUNCTION "enforce_activity_draft_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'activity draft history cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."version" <> 1 OR NEW."status" NOT IN ('EDITING', 'READY_FOR_PREVIEW') OR NEW."sealed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'activity drafts must start at version 1 and remain unsealed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."owner_id" IS DISTINCT FROM OLD."owner_id" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'activity draft identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" = 'SEALED' THEN
    RAISE EXCEPTION 'sealed activity drafts cannot be changed' USING ERRCODE = '55000';
  END IF;
  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'activity draft update time cannot move backwards' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'READY_FOR_PREVIEW' AND NEW."status" = 'SEALED' THEN
    IF NEW."version" IS DISTINCT FROM OLD."version"
      OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
      OR NEW."task_book" IS DISTINCT FROM OLD."task_book"
      OR NEW."title" IS DISTINCT FROM OLD."title"
      OR NEW."summary" IS DISTINCT FROM OLD."summary"
      OR NEW."learning_objectives" IS DISTINCT FROM OLD."learning_objectives"
      OR NEW."task_instructions" IS DISTINCT FROM OLD."task_instructions"
      OR NEW."evidence_requirements" IS DISTINCT FROM OLD."evidence_requirements"
      OR NEW."feedback_criteria" IS DISTINCT FROM OLD."feedback_criteria"
      OR NEW."sealed_at" IS NULL THEN
      RAISE EXCEPTION 'publication may only seal the unchanged ready revision' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" = 'SEALED' OR NEW."sealed_at" IS NOT NULL THEN
    RAISE EXCEPTION 'only a ready draft can be sealed for publication' USING ERRCODE = '55000';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'activity draft versions must advance exactly one step' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "require_activity_draft_revision_consistency"()
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
  IF TG_TABLE_NAME = 'activity_drafts' THEN draft_uuid := NEW."id"; ELSE draft_uuid := NEW."draft_id"; END IF;
  SELECT * INTO current_draft FROM "activity_drafts" AS draft WHERE draft."id" = draft_uuid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  draft_version := current_draft."version";
  SELECT count(*) INTO revision_count FROM "activity_draft_revisions" AS revision
    WHERE revision."draft_id" = draft_uuid AND revision."version" <= draft_version;
  IF revision_count <> draft_version OR EXISTS (
    SELECT 1 FROM "activity_draft_revisions" AS revision
    WHERE revision."draft_id" = draft_uuid AND revision."version" > draft_version
  ) THEN RAISE EXCEPTION 'activity draft % has an inconsistent revision sequence', draft_uuid USING ERRCODE = '23514'; END IF;
  SELECT * INTO current_revision FROM "activity_draft_revisions" AS revision
    WHERE revision."draft_id" = draft_uuid AND revision."version" = draft_version;
  IF NOT FOUND
    OR current_draft."schema_version" IS DISTINCT FROM current_revision."schema_version"
    OR current_draft."task_book" IS DISTINCT FROM current_revision."task_book"
    OR current_draft."title" IS DISTINCT FROM current_revision."title"
    OR current_draft."summary" IS DISTINCT FROM current_revision."summary"
    OR current_draft."learning_objectives" IS DISTINCT FROM current_revision."learning_objectives"
    OR current_draft."task_instructions" IS DISTINCT FROM current_revision."task_instructions"
    OR current_draft."evidence_requirements" IS DISTINCT FROM current_revision."evidence_requirements"
    OR current_draft."feedback_criteria" IS DISTINCT FROM current_revision."feedback_criteria" THEN
    RAISE EXCEPTION 'activity draft % does not match its current revision', draft_uuid USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

-- Retain the exact v1 validator unchanged, and add an explicit v2 branch.
ALTER FUNCTION "assert_activity_release_integrity"(UUID)
  RENAME TO "assert_activity_release_integrity_v1";

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
  expected_payload_hash TEXT;
  payload_due_at TIMESTAMPTZ;
  publisher_role "UserRole";
  classroom_manager_id UUID;
  run_actor_id UUID;
  run_status "AgentRunStatus";
BEGIN
  SELECT * INTO release_row FROM "activity_releases" WHERE "id" = target_release_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'activity release % does not exist', target_release_id USING ERRCODE = '23514'; END IF;
  SELECT * INTO snapshot_row FROM "activity_release_snapshots" WHERE "release_id" = target_release_id;
  IF snapshot_row."schema_version" = 1 THEN
    PERFORM "assert_activity_release_integrity_v1"(target_release_id);
    RETURN;
  END IF;
  IF snapshot_row."schema_version" <> 2 THEN
    RAISE EXCEPTION 'activity release % has an unknown snapshot schema', target_release_id USING ERRCODE = '23514';
  END IF;
  SELECT * INTO intent_row FROM "action_intents" WHERE "id" = release_row."action_intent_id";
  SELECT * INTO draft_row FROM "activity_drafts" WHERE "id" = release_row."source_draft_id";
  SELECT * INTO revision_row FROM "activity_draft_revisions"
    WHERE "draft_id" = snapshot_row."source_draft_id" AND "version" = snapshot_row."source_draft_version";
  IF intent_row."id" IS NULL OR draft_row."id" IS NULL OR revision_row."id" IS NULL THEN
    RAISE EXCEPTION 'activity release % requires its immutable source facts', target_release_id USING ERRCODE = '23514';
  END IF;
  SELECT "role" INTO publisher_role FROM "app_users" WHERE "id" = release_row."publisher_id";
  SELECT "manager_id" INTO classroom_manager_id FROM "classrooms" WHERE "id" = release_row."classroom_id";
  IF publisher_role IS DISTINCT FROM 'TEACHER' OR classroom_manager_id IS DISTINCT FROM release_row."publisher_id" OR draft_row."owner_id" IS DISTINCT FROM release_row."publisher_id" THEN
    RAISE EXCEPTION 'activity release % publisher does not own its draft and classroom', target_release_id USING ERRCODE = '23514';
  END IF;
  IF intent_row."status" <> 'EXECUTED' OR intent_row."action_name" <> 'publish_activity_release'
    OR intent_row."target_type" <> 'ActivityDraft' OR intent_row."actor_id" IS DISTINCT FROM release_row."publisher_id"
    OR intent_row."decided_by_id" IS DISTINCT FROM release_row."publisher_id"
    OR intent_row."target_id" IS DISTINCT FROM release_row."source_draft_id"
    OR intent_row."expected_version" IS DISTINCT FROM snapshot_row."source_draft_version"
    OR intent_row."executed_at" IS DISTINCT FROM release_row."published_at" THEN
    RAISE EXCEPTION 'activity release % is not backed by its executed publish intent', target_release_id USING ERRCODE = '23514';
  END IF;
  BEGIN
    IF intent_row."payload" -> 'dueAt' = 'null'::JSONB THEN payload_due_at := NULL;
    ELSE payload_due_at := (intent_row."payload" ->> 'dueAt')::TIMESTAMPTZ; END IF;
    IF (intent_row."payload" ->> 'draftId')::UUID IS DISTINCT FROM release_row."source_draft_id"
      OR (intent_row."payload" ->> 'classroomId')::UUID IS DISTINCT FROM release_row."classroom_id"
      OR intent_row."payload" -> 'expectedDraftVersion' IS DISTINCT FROM to_jsonb(snapshot_row."source_draft_version")
      OR payload_due_at IS DISTINCT FROM release_row."due_at" THEN
      RAISE EXCEPTION 'activity release % differs from its confirmed publish payload', target_release_id USING ERRCODE = '23514';
    END IF;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR numeric_value_out_of_range OR datetime_field_overflow THEN
    RAISE EXCEPTION 'activity release % publish payload contains invalid typed values', target_release_id USING ERRCODE = '23514';
  END;
  expected_payload_hash := encode(sha256(convert_to("cdas_publish_payload_canonical"(intent_row."payload"), 'UTF8')), 'hex');
  IF intent_row."payload_hash" IS DISTINCT FROM expected_payload_hash THEN RAISE EXCEPTION 'activity release % publish payload hash is invalid', target_release_id USING ERRCODE = '23514'; END IF;
  IF draft_row."status" <> 'SEALED' OR draft_row."version" IS DISTINCT FROM snapshot_row."source_draft_version"
    OR draft_row."sealed_at" IS DISTINCT FROM release_row."published_at" OR draft_row."schema_version" <> 2
    OR draft_row."task_book" IS DISTINCT FROM revision_row."task_book" THEN
    RAISE EXCEPTION 'activity release % source draft is not the exact sealed v2 revision', target_release_id USING ERRCODE = '23514';
  END IF;
  IF revision_row."schema_version" <> 2 OR revision_row."task_book" IS NULL
    OR snapshot_row."source_draft_id" IS DISTINCT FROM release_row."source_draft_id"
    OR snapshot_row."content" IS DISTINCT FROM revision_row."task_book"
    OR snapshot_row."content_hash" IS DISTINCT FROM encode(sha256(convert_to(revision_row."task_book"::TEXT, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'activity release % snapshot is not the canonical v2 source revision', target_release_id USING ERRCODE = '23514';
  END IF;
  IF intent_row."agent_run_id" IS NOT NULL THEN
    SELECT "actor_id", "status" INTO run_actor_id, run_status FROM "agent_runs" WHERE "id" = intent_row."agent_run_id";
    IF NOT FOUND OR run_actor_id IS DISTINCT FROM release_row."publisher_id" OR run_status <> 'SUCCEEDED' THEN
      RAISE EXCEPTION 'activity release % Agent intent requires its succeeded owning run', target_release_id USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

-- Rebind the deferred trigger to the new schema-dispatching validator. The
-- prior PL/pgSQL body may have cached the v1 function OID before its rename.
CREATE OR REPLACE FUNCTION "enforce_activity_release_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  release_uuid UUID;
BEGIN
  IF TG_TABLE_NAME = 'activity_releases' THEN
    release_uuid := NEW."id";
  ELSIF TG_TABLE_NAME = 'action_intents' THEN
    SELECT release."id" INTO release_uuid FROM "activity_releases" AS release
      WHERE release."action_intent_id" = NEW."id";
    IF NOT FOUND THEN RAISE EXCEPTION 'executed publish intent % requires one activity release', NEW."id" USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT release."id" INTO release_uuid FROM "activity_releases" AS release
      WHERE release."source_draft_id" = NEW."id";
    IF NOT FOUND THEN RAISE EXCEPTION 'sealed activity draft % requires one activity release', NEW."id" USING ERRCODE = '23514'; END IF;
  END IF;
  PERFORM "assert_activity_release_integrity"(release_uuid);
  RETURN NULL;
END;
$$;
