-- D-055: v3 is a forward-only JSON task-book extension.  No Prisma table is
-- changed and v1/v2 rows continue through their existing validators.

CREATE FUNCTION "cdas_activity_task_book_v3_is_valid"(task_book JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  stage TEXT;
  grade_number INTEGER;
  main_discipline TEXT;
  selected_disciplines TEXT[];
  goal_ids TEXT[];
  phase_goal_ids TEXT[];
  rubric_goal_ids TEXT[];
  assignment_type TEXT;
  assignment_subtype JSONB;
BEGIN
  IF jsonb_typeof(task_book) <> 'object'
    OR NOT task_book ?& ARRAY[
      'schemaVersion', 'title', 'topic', 'summary', 'schoolStage', 'grade',
      'mainDisciplineCode', 'integratedDisciplineCodes', 'disciplineContributions',
      'assignmentType', 'assignmentSubtype', 'inquiryDepth', 'submissionMode',
      'durationWeeks', 'backgroundSetting', 'taskInstructions', 'learningGoals',
      'phases', 'rubricDimensions'
    ]
    OR (SELECT count(*) FROM jsonb_object_keys(task_book)) <> 19
    OR task_book -> 'schemaVersion' <> '3'::JSONB
    OR jsonb_typeof(task_book -> 'grade') <> 'number'
    OR jsonb_typeof(task_book -> 'durationWeeks') <> 'number'
    OR (task_book ->> 'grade') !~ '^[0-9]+$'
    OR (task_book ->> 'durationWeeks') !~ '^[0-9]+$'
    OR EXISTS (
      SELECT 1 FROM unnest(ARRAY[
        'title', 'topic', 'summary', 'schoolStage', 'mainDisciplineCode',
        'assignmentType', 'submissionMode', 'backgroundSetting', 'taskInstructions'
      ]) key_name
      WHERE jsonb_typeof(task_book -> key_name) <> 'string'
        OR btrim(task_book ->> key_name) = ''
    )
    OR jsonb_typeof(task_book -> 'integratedDisciplineCodes') <> 'array'
    OR jsonb_typeof(task_book -> 'disciplineContributions') <> 'array'
    OR jsonb_typeof(task_book -> 'learningGoals') <> 'array'
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
    OR task_book ->> 'submissionMode' NOT IN ('phased', 'once', 'mixed')
    OR assignment_type NOT IN ('practical', 'inquiry', 'project')
    OR (task_book -> 'inquiryDepth' <> 'null'::JSONB AND task_book ->> 'inquiryDepth' NOT IN ('basic', 'intermediate', 'deep'))
    OR (assignment_type = 'inquiry' AND task_book -> 'inquiryDepth' = 'null'::JSONB)
    OR (assignment_type <> 'inquiry' AND task_book -> 'inquiryDepth' <> 'null'::JSONB)
    OR (assignment_type = 'project' AND assignment_subtype <> 'null'::JSONB)
    OR (assignment_type = 'practical' AND (jsonb_typeof(assignment_subtype) <> 'string' OR task_book ->> 'assignmentSubtype' NOT IN ('visit', 'simulation', 'observation')))
    OR (assignment_type = 'inquiry' AND (jsonb_typeof(assignment_subtype) <> 'string' OR task_book ->> 'assignmentSubtype' NOT IN ('literature', 'survey', 'experiment')))
    OR (stage = 'PRIMARY' AND main_discipline NOT IN ('politics', 'chinese', 'math', 'english', 'science', 'infoTech', 'labor', 'arts', 'sports', 'integrated'))
    OR (stage = 'MIDDLE' AND main_discipline NOT IN ('politics', 'chinese', 'math', 'english', 'history', 'geography', 'physics', 'chemistry', 'biology', 'infoTech', 'labor', 'arts', 'sports', 'integrated')) THEN
    RETURN FALSE;
  END IF;

  IF jsonb_array_length(task_book -> 'integratedDisciplineCodes') NOT BETWEEN 1 AND 14
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(task_book -> 'integratedDisciplineCodes') item WHERE jsonb_typeof(item) <> 'string')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(task_book -> 'integratedDisciplineCodes') code WHERE code = main_discipline OR (stage = 'PRIMARY' AND code NOT IN ('politics', 'chinese', 'math', 'english', 'science', 'infoTech', 'labor', 'arts', 'sports', 'integrated')) OR (stage = 'MIDDLE' AND code NOT IN ('politics', 'chinese', 'math', 'english', 'history', 'geography', 'physics', 'chemistry', 'biology', 'infoTech', 'labor', 'arts', 'sports', 'integrated')))
    OR (SELECT count(*) FROM jsonb_array_elements_text(task_book -> 'integratedDisciplineCodes')) <> (SELECT count(DISTINCT code) FROM jsonb_array_elements_text(task_book -> 'integratedDisciplineCodes')) THEN
    RETURN FALSE;
  END IF;
  selected_disciplines := ARRAY[main_discipline] || ARRAY(SELECT jsonb_array_elements_text(task_book -> 'integratedDisciplineCodes'));

  IF jsonb_array_length(task_book -> 'disciplineContributions') <> cardinality(selected_disciplines)
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(task_book -> 'disciplineContributions') item
      WHERE jsonb_typeof(item) <> 'object' OR NOT item ?& ARRAY['disciplineCode', 'contribution', 'necessity']
        OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
        OR jsonb_typeof(item -> 'disciplineCode') <> 'string'
        OR jsonb_typeof(item -> 'contribution') <> 'string' OR btrim(item ->> 'contribution') = ''
        OR jsonb_typeof(item -> 'necessity') <> 'string' OR btrim(item ->> 'necessity') = ''
    )
    OR (SELECT count(*) FROM jsonb_array_elements_text(jsonb_path_query_array(task_book, '$.disciplineContributions[*].disciplineCode'))) <> (SELECT count(DISTINCT code) FROM jsonb_array_elements_text(jsonb_path_query_array(task_book, '$.disciplineContributions[*].disciplineCode')) code)
    OR EXISTS (SELECT 1 FROM unnest(selected_disciplines) code WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(task_book -> 'disciplineContributions') item WHERE item ->> 'disciplineCode' = code)) THEN
    RETURN FALSE;
  END IF;

  IF jsonb_array_length(task_book -> 'learningGoals') NOT BETWEEN 2 AND 8
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(task_book -> 'learningGoals') goal
      WHERE jsonb_typeof(goal) <> 'object' OR NOT goal ?& ARRAY['id', 'description', 'competencyReferences']
        OR (SELECT count(*) FROM jsonb_object_keys(goal)) <> 3
        OR jsonb_typeof(goal -> 'id') <> 'string' OR goal ->> 'id' !~ '^[a-z][a-z0-9_-]{0,63}$'
        OR jsonb_typeof(goal -> 'description') <> 'string' OR btrim(goal ->> 'description') = ''
        OR jsonb_typeof(goal -> 'competencyReferences') <> 'array' OR jsonb_array_length(goal -> 'competencyReferences') NOT BETWEEN 1 AND 3
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(goal -> 'competencyReferences') ref WHERE jsonb_typeof(ref) <> 'object' OR NOT ref ?& ARRAY['disciplineCode', 'competencyCode'] OR (SELECT count(*) FROM jsonb_object_keys(ref)) <> 2 OR jsonb_typeof(ref -> 'disciplineCode') <> 'string' OR jsonb_typeof(ref -> 'competencyCode') <> 'string' OR btrim(ref ->> 'competencyCode') = '')
  ) THEN
    RETURN FALSE;
  END IF;
  -- JSONB guards cannot import the application registry, but they still bind a
  -- reference to a selected non-integrated discipline and reject duplicates.
  -- The complete code/stage/grade lookup remains the versioned TypeScript
  -- registry used by every save and assistant path.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(task_book -> 'learningGoals') goal
    WHERE (SELECT count(*) FROM jsonb_array_elements(goal -> 'competencyReferences'))
        <> (SELECT count(DISTINCT (ref ->> 'disciplineCode') || ':' || (ref ->> 'competencyCode')) FROM jsonb_array_elements(goal -> 'competencyReferences') ref)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(goal -> 'competencyReferences') ref
        WHERE ref ->> 'disciplineCode' = 'integrated' OR NOT ((ref ->> 'disciplineCode') = ANY(selected_disciplines))
      )
  ) THEN RETURN FALSE; END IF;
  goal_ids := ARRAY(SELECT jsonb_array_elements_text(jsonb_path_query_array(task_book, '$.learningGoals[*].id')));
  IF cardinality(goal_ids) <> (SELECT count(DISTINCT goal_id) FROM unnest(goal_ids) goal_id) THEN RETURN FALSE; END IF;

  IF jsonb_array_length(task_book -> 'phases') NOT BETWEEN 3 AND 4
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(task_book -> 'phases') phase
      WHERE jsonb_typeof(phase) <> 'object' OR NOT phase ?& ARRAY['name', 'action', 'context', 'support', 'learningGoalIds', 'evidence', 'evaluationFocus', 'suggestedLessons']
        OR (SELECT count(*) FROM jsonb_object_keys(phase)) <> 8
        OR EXISTS (SELECT 1 FROM unnest(ARRAY['name','action','context','support','evaluationFocus']) k WHERE jsonb_typeof(phase -> k) <> 'string' OR btrim(phase ->> k) = '')
        OR jsonb_typeof(phase -> 'suggestedLessons') <> 'number' OR (phase ->> 'suggestedLessons') !~ '^[0-9]+$' OR (phase ->> 'suggestedLessons')::INTEGER NOT BETWEEN 1 AND 16
        OR jsonb_typeof(phase -> 'learningGoalIds') <> 'array' OR jsonb_array_length(phase -> 'learningGoalIds') NOT BETWEEN 1 AND 8
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(phase -> 'learningGoalIds') id WHERE NOT id = ANY(goal_ids))
        OR jsonb_typeof(phase -> 'evidence') <> 'array' OR jsonb_array_length(phase -> 'evidence') NOT BETWEEN 1 AND 4
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(phase -> 'evidence') evidence WHERE jsonb_typeof(evidence) <> 'object' OR NOT evidence ?& ARRAY['type','description'] OR (SELECT count(*) FROM jsonb_object_keys(evidence)) <> 2 OR evidence ->> 'type' NOT IN ('text','document','image','confirm') OR jsonb_typeof(evidence -> 'description') <> 'string' OR btrim(evidence ->> 'description') = '')
  ) THEN RETURN FALSE; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(task_book -> 'phases') phase
    WHERE (SELECT count(*) FROM jsonb_array_elements_text(phase -> 'learningGoalIds'))
        <> (SELECT count(DISTINCT id) FROM jsonb_array_elements_text(phase -> 'learningGoalIds') id)
  ) THEN RETURN FALSE; END IF;
  phase_goal_ids := ARRAY(SELECT jsonb_array_elements_text(jsonb_path_query_array(task_book, '$.phases[*].learningGoalIds[*]')));

  IF jsonb_array_length(task_book -> 'rubricDimensions') NOT BETWEEN 4 AND 8
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(task_book -> 'rubricDimensions') dimension
      WHERE jsonb_typeof(dimension) <> 'object' OR NOT dimension ?& ARRAY['name','excellent','good','pass','improve','learningGoalIds']
        OR (SELECT count(*) FROM jsonb_object_keys(dimension)) <> 6
        OR EXISTS (SELECT 1 FROM unnest(ARRAY['name','excellent','good','pass','improve']) k WHERE jsonb_typeof(dimension -> k) <> 'string' OR btrim(dimension ->> k) = '')
        OR jsonb_typeof(dimension -> 'learningGoalIds') <> 'array' OR jsonb_array_length(dimension -> 'learningGoalIds') NOT BETWEEN 1 AND 8
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(dimension -> 'learningGoalIds') id WHERE NOT id = ANY(goal_ids))
  ) THEN RETURN FALSE; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(task_book -> 'rubricDimensions') dimension
    WHERE (SELECT count(*) FROM jsonb_array_elements_text(dimension -> 'learningGoalIds'))
        <> (SELECT count(DISTINCT id) FROM jsonb_array_elements_text(dimension -> 'learningGoalIds') id)
  ) THEN RETURN FALSE; END IF;
  rubric_goal_ids := ARRAY(SELECT jsonb_array_elements_text(jsonb_path_query_array(task_book, '$.rubricDimensions[*].learningGoalIds[*]')));
  IF EXISTS (SELECT 1 FROM unnest(goal_ids) id WHERE NOT id = ANY(phase_goal_ids) OR NOT id = ANY(rubric_goal_ids)) THEN RETURN FALSE; END IF;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

ALTER TABLE "activity_drafts" DROP CONSTRAINT "activity_drafts_task_book_version";
ALTER TABLE "activity_draft_revisions" DROP CONSTRAINT "activity_draft_revisions_task_book_version";

CREATE FUNCTION "cdas_activity_task_book_v3_projection_matches"(
  task_book JSONB,
  learning_objectives TEXT[],
  evidence_requirements TEXT[],
  feedback_criteria TEXT[],
  task_instructions TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE expected_objectives TEXT[]; expected_evidence TEXT[]; expected_criteria TEXT[];
BEGIN
  SELECT array_agg(goal ->> 'description' ORDER BY ordinal) INTO expected_objectives
    FROM jsonb_array_elements(task_book -> 'learningGoals') WITH ORDINALITY entry(goal, ordinal);
  SELECT array_agg(description ORDER BY first_ordinal) INTO expected_evidence FROM (
    SELECT evidence ->> 'description' AS description, min(phase_ordinal * 10 + evidence_ordinal) AS first_ordinal
    FROM jsonb_array_elements(task_book -> 'phases') WITH ORDINALITY phase_entry(phase, phase_ordinal),
      jsonb_array_elements(phase -> 'evidence') WITH ORDINALITY evidence_entry(evidence, evidence_ordinal)
    GROUP BY evidence ->> 'description'
  ) deduplicated;
  SELECT array_agg(dimension ->> 'name' ORDER BY ordinal) INTO expected_criteria
    FROM jsonb_array_elements(task_book -> 'rubricDimensions') WITH ORDINALITY entry(dimension, ordinal);
  RETURN learning_objectives IS NOT DISTINCT FROM expected_objectives
    AND evidence_requirements IS NOT DISTINCT FROM expected_evidence
    AND feedback_criteria IS NOT DISTINCT FROM expected_criteria
    AND task_instructions IS NOT DISTINCT FROM task_book ->> 'taskInstructions';
END;
$$;

ALTER TABLE "activity_drafts" ADD CONSTRAINT "activity_drafts_task_book_version" CHECK (
  ("schema_version" = 1 AND "task_book" IS NULL)
  OR ("schema_version" = 2 AND "cdas_activity_task_book_v2_is_valid"("task_book") AND "task_book" ->> 'title' = "title" AND "task_book" ->> 'summary' = "summary" AND "task_book" -> 'learningObjectives' = to_jsonb("learning_objectives") AND "task_book" ->> 'taskInstructions' = "task_instructions" AND "task_book" -> 'evidenceRequirements' = to_jsonb("evidence_requirements") AND "task_book" -> 'feedbackCriteria' = to_jsonb("feedback_criteria"))
  OR ("schema_version" = 3 AND "cdas_activity_task_book_v3_is_valid"("task_book") AND "task_book" ->> 'title' = "title" AND "task_book" ->> 'summary' = "summary" AND "cdas_activity_task_book_v3_projection_matches"("task_book", "learning_objectives", "evidence_requirements", "feedback_criteria", "task_instructions"))
);

ALTER TABLE "activity_draft_revisions" ADD CONSTRAINT "activity_draft_revisions_task_book_version" CHECK (
  ("schema_version" = 1 AND "task_book" IS NULL)
  OR ("schema_version" = 2 AND "cdas_activity_task_book_v2_is_valid"("task_book") AND "task_book" ->> 'title' = "title" AND "task_book" ->> 'summary' = "summary" AND "task_book" -> 'learningObjectives' = to_jsonb("learning_objectives") AND "task_book" ->> 'taskInstructions' = "task_instructions" AND "task_book" -> 'evidenceRequirements' = to_jsonb("evidence_requirements") AND "task_book" -> 'feedbackCriteria' = to_jsonb("feedback_criteria"))
  OR ("schema_version" = 3 AND "cdas_activity_task_book_v3_is_valid"("task_book") AND "task_book" ->> 'title' = "title" AND "task_book" ->> 'summary' = "summary" AND "cdas_activity_task_book_v3_projection_matches"("task_book", "learning_objectives", "evidence_requirements", "feedback_criteria", "task_instructions"))
);

-- Keep the previous complete v1/v2 release validator intact. Only a v3
-- snapshot takes the new branch; its source, seal and JSONB hash contracts
-- are the same immutable facts as v2.
ALTER FUNCTION "assert_activity_release_integrity"(UUID) RENAME TO "assert_activity_release_integrity_v2";
CREATE FUNCTION "assert_activity_release_integrity"(target_release_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
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
  IF snapshot_row."schema_version" <> 3 THEN
    PERFORM "assert_activity_release_integrity_v2"(target_release_id);
    RETURN;
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
    OR draft_row."sealed_at" IS DISTINCT FROM release_row."published_at" OR draft_row."schema_version" <> 3
    OR NOT "cdas_activity_task_book_v3_is_valid"(draft_row."task_book")
    OR draft_row."task_book" IS DISTINCT FROM revision_row."task_book" THEN
    RAISE EXCEPTION 'activity release % source draft is not the exact sealed v3 revision', target_release_id USING ERRCODE = '23514';
  END IF;
  IF revision_row."schema_version" <> 3 OR revision_row."task_book" IS NULL
    OR NOT "cdas_activity_task_book_v3_is_valid"(revision_row."task_book")
    OR snapshot_row."source_draft_id" IS DISTINCT FROM release_row."source_draft_id"
    OR snapshot_row."content" IS DISTINCT FROM revision_row."task_book"
    OR snapshot_row."content_hash" IS DISTINCT FROM encode(sha256(convert_to(revision_row."task_book"::TEXT, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'activity release % snapshot is not the canonical v3 source revision', target_release_id USING ERRCODE = '23514';
  END IF;
  IF intent_row."agent_run_id" IS NOT NULL THEN
    SELECT "actor_id", "status" INTO run_actor_id, run_status FROM "agent_runs" WHERE "id" = intent_row."agent_run_id";
    IF NOT FOUND OR run_actor_id IS DISTINCT FROM release_row."publisher_id" OR run_status <> 'SUCCEEDED' THEN
      RAISE EXCEPTION 'activity release % Agent intent requires its succeeded owning run', target_release_id USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "assert_submission_phase_scope"(release_uuid UUID, student_uuid UUID, phase_number INTEGER)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE execution_version_value INTEGER; content_value JSONB; phase_count INTEGER; submission_mode TEXT;
BEGIN
  SELECT release."execution_version", snapshot."content" INTO execution_version_value, content_value FROM "activity_releases" release JOIN "activity_release_snapshots" snapshot ON snapshot."release_id" = release."id" WHERE release."id" = release_uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission requires a released activity snapshot' USING ERRCODE = '23514'; END IF;
  IF execution_version_value = 0 THEN IF phase_number <> 0 THEN RAISE EXCEPTION 'whole-task execution only accepts phase 0' USING ERRCODE = '23514'; END IF; RETURN; END IF;
  IF execution_version_value <> 1 OR content_value ->> 'schemaVersion' NOT IN ('2','3') OR jsonb_typeof(content_value -> 'phases') <> 'array' THEN RAISE EXCEPTION 'sequential execution requires a structured phase snapshot' USING ERRCODE = '23514'; END IF;
  phase_count := jsonb_array_length(content_value -> 'phases'); submission_mode := content_value ->> 'submissionMode';
  IF submission_mode NOT IN ('phased','mixed') THEN RAISE EXCEPTION 'sequential execution requires phased or mixed mode' USING ERRCODE = '23514'; END IF;
  IF phase_number = 0 THEN IF submission_mode <> 'mixed' OR EXISTS (SELECT 1 FROM generate_series(1, phase_count) expected_phase WHERE NOT EXISTS (SELECT 1 FROM "submissions" prerequisite WHERE prerequisite."release_id" = release_uuid AND prerequisite."student_id" = student_uuid AND prerequisite."phase_index" = expected_phase AND prerequisite."latest_revision_number" > 0)) THEN RAISE EXCEPTION 'mixed final submission requires every phase revision' USING ERRCODE = '23514'; END IF; RETURN; END IF;
  IF phase_number < 1 OR phase_number > phase_count THEN RAISE EXCEPTION 'submission phase is outside the frozen snapshot' USING ERRCODE = '23514'; END IF;
  IF phase_number > 1 AND NOT EXISTS (SELECT 1 FROM "submissions" prerequisite WHERE prerequisite."release_id" = release_uuid AND prerequisite."student_id" = student_uuid AND prerequisite."phase_index" = phase_number - 1 AND prerequisite."latest_revision_number" > 0) THEN RAISE EXCEPTION 'submission phase prerequisite is incomplete' USING ERRCODE = '23514'; END IF;
END;
$$;

-- Group submissions own their prerequisite chain through group_id, so the
-- personal-submission helper above cannot be reused verbatim.
CREATE OR REPLACE FUNCTION "assert_submission_subject"(
  release_uuid UUID,
  student_uuid UUID,
  group_uuid UUID,
  phase_number INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  group_release_uuid UUID;
  execution_version_value INTEGER;
  content_value JSONB;
  phase_count INTEGER;
  submission_mode TEXT;
BEGIN
  IF (student_uuid IS NULL) = (group_uuid IS NULL) THEN
    RAISE EXCEPTION 'submission must have exactly one subject' USING ERRCODE = '23514';
  END IF;
  IF student_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(release_uuid::TEXT || ':' || student_uuid::TEXT, 0));
    IF EXISTS (
      SELECT 1 FROM "release_group_members" member
      JOIN "release_groups" group_row ON group_row."id" = member."group_id"
      WHERE group_row."release_id" = release_uuid AND member."student_id" = student_uuid
    ) THEN
      RAISE EXCEPTION 'group member cannot create personal submission' USING ERRCODE = '23514';
    END IF;
    PERFORM "assert_submission_phase_scope"(release_uuid, student_uuid, phase_number);
    RETURN;
  END IF;
  SELECT "release_id" INTO group_release_uuid FROM "release_groups" WHERE "id" = group_uuid FOR UPDATE;
  IF NOT FOUND OR group_release_uuid <> release_uuid THEN
    RAISE EXCEPTION 'submission group must belong to release' USING ERRCODE = '23514';
  END IF;
  SELECT release."execution_version", snapshot."content"
    INTO execution_version_value, content_value
    FROM "activity_releases" release JOIN "activity_release_snapshots" snapshot
      ON snapshot."release_id" = release."id"
    WHERE release."id" = release_uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission requires a released activity snapshot' USING ERRCODE = '23514'; END IF;
  IF execution_version_value = 0 THEN
    IF phase_number <> 0 THEN RAISE EXCEPTION 'whole-task execution only accepts phase 0' USING ERRCODE = '23514'; END IF;
    RETURN;
  END IF;
  IF execution_version_value <> 1 OR content_value ->> 'schemaVersion' NOT IN ('2','3') OR jsonb_typeof(content_value -> 'phases') <> 'array' THEN
    RAISE EXCEPTION 'sequential execution requires a structured phase snapshot' USING ERRCODE = '23514';
  END IF;
  phase_count := jsonb_array_length(content_value -> 'phases');
  submission_mode := content_value ->> 'submissionMode';
  IF submission_mode NOT IN ('phased','mixed') THEN
    RAISE EXCEPTION 'sequential execution requires phased or mixed mode' USING ERRCODE = '23514';
  END IF;
  IF phase_number = 0 THEN
    IF submission_mode <> 'mixed' OR EXISTS (
      SELECT 1 FROM generate_series(1, phase_count) expected_phase
      WHERE NOT EXISTS (
        SELECT 1 FROM "submissions" prerequisite
        WHERE prerequisite."release_id" = release_uuid AND prerequisite."group_id" = group_uuid
          AND prerequisite."phase_index" = expected_phase AND prerequisite."latest_revision_number" > 0
      )
    ) THEN RAISE EXCEPTION 'mixed final submission requires every phase revision' USING ERRCODE = '23514'; END IF;
    RETURN;
  END IF;
  IF phase_number < 1 OR phase_number > phase_count THEN
    RAISE EXCEPTION 'submission phase is outside the frozen snapshot' USING ERRCODE = '23514';
  END IF;
  IF phase_number > 1 AND NOT EXISTS (
    SELECT 1 FROM "submissions" prerequisite
    WHERE prerequisite."release_id" = release_uuid AND prerequisite."group_id" = group_uuid
      AND prerequisite."phase_index" = phase_number - 1 AND prerequisite."latest_revision_number" > 0
  ) THEN RAISE EXCEPTION 'submission phase prerequisite is incomplete' USING ERRCODE = '23514'; END IF;
END;
$$;

ALTER FUNCTION "assert_teacher_evaluation_outcomes"(UUID, JSONB) RENAME TO "assert_teacher_evaluation_outcomes_v2";
CREATE FUNCTION "assert_teacher_evaluation_outcomes"(target_submission_revision_id UUID, outcomes JSONB)
RETURNS void LANGUAGE plpgsql AS $$
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
  SELECT snapshot."schema_version", snapshot."content", revision."text_evidence", revision."completed_evidence_indexes"
    INTO snapshot_schema_version, snapshot_content, revision_text, completed_indexes
    FROM "submission_revisions" revision
    JOIN "submissions" submission ON submission."id" = revision."submission_id"
    JOIN "activity_release_snapshots" snapshot ON snapshot."release_id" = submission."release_id"
    WHERE revision."id" = target_submission_revision_id;
  IF NOT FOUND OR snapshot_schema_version NOT IN (2,3) OR snapshot_content ->> 'schemaVersion' NOT IN ('2','3') THEN
    RAISE EXCEPTION 'teacher evaluation requires a structured task-book rubric' USING ERRCODE = '23514';
  END IF;
  IF snapshot_schema_version = 2 THEN
    PERFORM "assert_teacher_evaluation_outcomes_v2"(target_submission_revision_id, outcomes);
    RETURN;
  END IF;
  dimensions := snapshot_content -> 'rubricDimensions';
  IF jsonb_typeof(outcomes) <> 'array' OR jsonb_typeof(dimensions) <> 'array' THEN
    RAISE EXCEPTION 'teacher evaluation outcomes must cover the frozen rubric' USING ERRCODE = '23514';
  END IF;
  outcome_count := jsonb_array_length(outcomes);
  dimension_count := jsonb_array_length(dimensions);
  IF dimension_count < 4 OR dimension_count > 8 OR outcome_count <> dimension_count THEN
    RAISE EXCEPTION 'teacher evaluation must cover every frozen rubric dimension' USING ERRCODE = '23514';
  END IF;
  FOR outcome_index IN 0 .. outcome_count - 1 LOOP
    outcome := outcomes -> outcome_index;
    dimension := dimensions -> outcome_index;
    IF jsonb_typeof(outcome) <> 'object' OR jsonb_typeof(dimension) <> 'object'
      OR outcome -> 'dimensionIndex' IS DISTINCT FROM to_jsonb(outcome_index + 1)
      OR outcome ->> 'dimensionName' IS DISTINCT FROM dimension ->> 'name' THEN
      RAISE EXCEPTION 'teacher evaluation outcome must match the frozen snapshot rubric' USING ERRCODE = '23514';
    END IF;
    status := outcome ->> 'status';
    citations := outcome -> 'citations';
    IF jsonb_typeof(citations) <> 'array' THEN RAISE EXCEPTION 'teacher evaluation citations must be an array' USING ERRCODE = '23514'; END IF;
    citation_count := jsonb_array_length(citations);
    IF status = 'LEVEL' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(outcome)) <> 5
        OR NOT outcome ?& ARRAY['dimensionIndex', 'dimensionName', 'status', 'level', 'citations']
        OR outcome ->> 'level' NOT IN ('excellent', 'good', 'pass', 'improve')
        OR citation_count NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'levelled evaluation outcomes require a rubric level and 1 to 5 citations' USING ERRCODE = '23514';
      END IF;
    ELSIF status = 'INSUFFICIENT_EVIDENCE' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(outcome)) <> 4
        OR NOT outcome ?& ARRAY['dimensionIndex', 'dimensionName', 'status', 'citations']
        OR citation_count <> 0 THEN
        RAISE EXCEPTION 'insufficient-evidence outcomes cannot carry a level or citations' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'teacher evaluation outcome status is not allowed' USING ERRCODE = '23514';
    END IF;
    SELECT count(*), count(DISTINCT citation_key) INTO citation_count, distinct_citation_count
      FROM (
        SELECT CASE
          WHEN jsonb_typeof(item.value) <> 'object' THEN NULL
          WHEN item.value ->> 'kind' = 'text' AND (SELECT count(*) FROM jsonb_object_keys(item.value)) = 1 THEN 'text'
          WHEN item.value ->> 'kind' = 'attachment' AND (SELECT count(*) FROM jsonb_object_keys(item.value)) = 2 AND item.value ? 'attachmentId' THEN 'attachment:' || (item.value ->> 'attachmentId')
          WHEN item.value ->> 'kind' = 'checkpoint' AND (SELECT count(*) FROM jsonb_object_keys(item.value)) = 2 AND item.value ? 'evidenceIndex' THEN 'checkpoint:' || (item.value ->> 'evidenceIndex')
          ELSE NULL END AS citation_key
        FROM jsonb_array_elements(citations) WITH ORDINALITY AS item(value, ordinality)
      ) citation_keys;
    IF status = 'LEVEL' AND (citation_count <> jsonb_array_length(citations) OR distinct_citation_count <> citation_count OR citation_count = 0) THEN
      RAISE EXCEPTION 'teacher evaluation citations must be unique and well-formed' USING ERRCODE = '23514';
    END IF;
    IF status = 'LEVEL' THEN
      FOR citation IN SELECT value FROM jsonb_array_elements(citations) LOOP
        IF citation ->> 'kind' = 'text' THEN
          IF NOT "cdas_text_has_visible_content"(revision_text) THEN RAISE EXCEPTION 'text citations require visible text evidence on the current revision' USING ERRCODE = '23514'; END IF;
        ELSIF citation ->> 'kind' = 'attachment' THEN
          BEGIN cited_attachment_id := (citation ->> 'attachmentId')::UUID;
          EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'attachment citations must name a ready revision attachment' USING ERRCODE = '23514'; END;
          IF NOT EXISTS (
            SELECT 1 FROM "submission_revision_attachments" link
            JOIN "submission_attachments" attachment ON attachment."id" = link."attachment_id"
            WHERE link."submission_revision_id" = target_submission_revision_id AND attachment."id" = cited_attachment_id AND attachment."status" = 'READY'
          ) THEN RAISE EXCEPTION 'attachment citations must name a ready revision attachment' USING ERRCODE = '23514'; END IF;
        ELSIF citation ->> 'kind' = 'checkpoint' THEN
          IF jsonb_typeof(citation -> 'evidenceIndex') <> 'number' OR (citation ->> 'evidenceIndex') !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'checkpoint citations must name a completed evidence index' USING ERRCODE = '23514';
          END IF;
          evidence_index := (citation ->> 'evidenceIndex')::INTEGER;
          IF evidence_index IS NULL OR NOT evidence_index = ANY(completed_indexes) THEN
            RAISE EXCEPTION 'checkpoint citations must name a completed evidence index' USING ERRCODE = '23514';
          END IF;
        ELSE
          RAISE EXCEPTION 'teacher evaluation citation kind is not allowed' USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
