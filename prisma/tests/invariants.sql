BEGIN;

DO $test$
DECLARE
  canonical_hash TEXT;
BEGIN
  canonical_hash := encode(
    sha256(convert_to(
      "cdas_activity_content_v1_canonical"(
        E'引号"、反斜线\\、换行\n与𠮷',
        'é / 水',
        ARRAY['目标一', '目标二'],
        E'观察\t并记录。',
        ARRAY['证据 A', '证据 B'],
        ARRAY['清楚', '可核验']
      ),
      'UTF8'
    )),
    'hex'
  );

  IF canonical_hash IS DISTINCT FROM
    'dba8c4eb5f68077966a1e257b6535422bb6f181b38152b352715a589be96e63a' THEN
    RAISE EXCEPTION 'PostgreSQL activity canonical bytes drifted: %', canonical_hash
      USING ERRCODE = '23514';
  END IF;
END
$test$;

INSERT INTO app_users (id, auth_subject, role, display_name, school_id, legacy_profile, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'teacher_fixture', 'TEACHER', '测试教师', 'c0de0000-0000-4000-8000-00000000c0de', true, now()),
  ('00000000-0000-4000-8000-000000000002', 'student_fixture', 'STUDENT', '测试学生', 'c0de0000-0000-4000-8000-00000000c0de', true, now());

DO $test$
DECLARE
  valid_task_book JSONB := $json$
  {
    "schemaVersion": 2,
    "title": "结构化任务书",
    "topic": "校园节水",
    "summary": "从真实现象形成证据与建议。",
    "schoolStage": "MIDDLE",
    "grade": 7,
    "mainDisciplineCode": "physics",
    "integratedDisciplineCodes": ["math", "chinese"],
    "crossDisciplinaryConceptCodes": ["system_model"],
    "assignmentType": "inquiry",
    "assignmentSubtype": "survey",
    "inquiryDepth": "deep",
    "submissionMode": "phased",
    "durationWeeks": 2,
    "backgroundSetting": "学校需要同学们提出有证据的节水建议。",
    "objectiveKnowledge": "理解校园用水与资源节约的关系。",
    "objectiveProcess": "使用观察和统计形成判断。",
    "objectiveEmotion": "愿意为公共资源负责。",
    "learningObjectives": ["理解校园用水与资源节约的关系。", "使用观察和统计形成判断。", "愿意为公共资源负责。"],
    "taskInstructions": "完成观察、分析和公开建议。",
    "evidenceRequirements": ["观察记录", "统计表", "建议稿"],
    "feedbackCriteria": ["问题意识", "证据质量", "跨学科连接", "方案表达"],
    "phases": [
      {"name":"观察","action":"观察场景。","context":"选择真实地点。","support":"使用记录表。","evidence":[{"type":"text","description":"观察记录"}],"evaluationFocus":"问题清楚。","suggestedLessons":1},
      {"name":"分析","action":"分析数据。","context":"比较记录。","support":"使用统计表。","evidence":[{"type":"document","description":"统计表"}],"evaluationFocus":"证据可靠。","suggestedLessons":1},
      {"name":"表达","action":"提出建议。","context":"面向真实对象。","support":"按证据组织表达。","evidence":[{"type":"text","description":"建议稿"}],"evaluationFocus":"建议可行。","suggestedLessons":1}
    ],
    "rubricDimensions": [
      {"name":"问题意识","excellent":"清楚可查。","good":"较清楚。","pass":"基本相关。","improve":"问题不清。"},
      {"name":"证据质量","excellent":"完整可靠。","good":"较充分。","pass":"有证据。","improve":"证据不足。"},
      {"name":"跨学科连接","excellent":"连接清楚。","good":"使用两科。","pass":"使用一科。","improve":"没有连接。"},
      {"name":"方案表达","excellent":"具体可行。","good":"较具体。","pass":"有建议。","improve":"建议空泛。"}
    ]
  }
  $json$::JSONB;
BEGIN
  IF NOT "cdas_activity_task_book_v2_is_valid"(valid_task_book) THEN
    RAISE EXCEPTION 'the valid v2 task-book fixture was rejected';
  END IF;

  BEGIN
    INSERT INTO activity_drafts (
      id, owner_id, status, version, schema_version, task_book,
      title, summary, learning_objectives, task_instructions,
      evidence_requirements, feedback_criteria, updated_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000030',
      '00000000-0000-4000-8000-000000000001',
      'EDITING', 1, 2, '{}'::JSONB,
      '伪造任务书', '不应写入', ARRAY['目标'], '不应写入',
      ARRAY['证据'], ARRAY['标准'], now()
    );
    RAISE EXCEPTION 'an empty v2 task book was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO activity_drafts (
      id, owner_id, status, version, schema_version, task_book,
      title, summary, learning_objectives, task_instructions,
      evidence_requirements, feedback_criteria, updated_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000031',
      '00000000-0000-4000-8000-000000000001',
      'EDITING', 1, 2, valid_task_book,
      '被篡改的标题', valid_task_book ->> 'summary',
      ARRAY(SELECT jsonb_array_elements_text(valid_task_book -> 'learningObjectives')),
      valid_task_book ->> 'taskInstructions',
      ARRAY(SELECT jsonb_array_elements_text(valid_task_book -> 'evidenceRequirements')),
      ARRAY(SELECT jsonb_array_elements_text(valid_task_book -> 'feedbackCriteria')),
      now()
    );
    RAISE EXCEPTION 'a v2 task book with a forged scalar projection was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO agent_runs (
      id,
      actor_id,
      status,
      model,
      started_at,
      completed_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000100',
      '00000000-0000-4000-8000-000000000001',
      'SUCCEEDED',
      'test',
      now(),
      now()
    );
    RAISE EXCEPTION 'a terminal AgentRun was inserted directly';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

INSERT INTO agent_runs (id, actor_id, status, model, started_at)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'RUNNING',
  'test',
  now()
);

DO $test$
BEGIN
  BEGIN
    UPDATE agent_runs
    SET model = 'replaced-model'
    WHERE id = '00000000-0000-4000-8000-000000000101';
    RAISE EXCEPTION 'AgentRun model mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    UPDATE agent_runs
    SET status = 'SUCCEEDED'
    WHERE id = '00000000-0000-4000-8000-000000000101';
    RAISE EXCEPTION 'AgentRun completed without a completion time';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

UPDATE agent_runs
SET status = 'SUCCEEDED', completed_at = now()
WHERE id = '00000000-0000-4000-8000-000000000101';

DO $test$
BEGIN
  BEGIN
    UPDATE agent_runs
    SET status = 'FAILED', failure_code = 'REWRITTEN'
    WHERE id = '00000000-0000-4000-8000-000000000101';
    RAISE EXCEPTION 'terminal AgentRun was rewritten';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    DELETE FROM agent_runs
    WHERE id = '00000000-0000-4000-8000-000000000101';
    RAISE EXCEPTION 'AgentRun provenance was deleted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

INSERT INTO classrooms (id, name, manager_id, school_id, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000010',
  '七年一班',
  '00000000-0000-4000-8000-000000000001',
  'c0de0000-0000-4000-8000-00000000c0de',
  now()
);

INSERT INTO classroom_memberships (id, classroom_id, student_id)
VALUES (
  '00000000-0000-4000-8000-000000000020',
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000002'
);

DO $test$
BEGIN
  BEGIN
    INSERT INTO classroom_memberships (id, classroom_id, student_id)
    VALUES (
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'duplicate active membership was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO classroom_memberships (
      id,
      classroom_id,
      student_id,
      joined_at,
      ended_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000022',
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000002',
      now() - interval '1 day',
      now() + interval '1 day'
    );
    RAISE EXCEPTION 'overlapping membership interval was accepted';
  EXCEPTION WHEN exclusion_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO activity_drafts (
      id,
      owner_id,
      status,
      version,
      title,
      summary,
      task_instructions,
      sealed_at,
      updated_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000035',
      '00000000-0000-4000-8000-000000000001',
      'SEALED',
      1,
      '绕过发布的封存草稿',
      '不应直接成为历史',
      '无',
      now(),
      now()
    );
    RAISE EXCEPTION 'a draft was inserted directly as sealed';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    DELETE FROM classroom_memberships
    WHERE id = '00000000-0000-4000-8000-000000000020';
    RAISE EXCEPTION 'membership history deletion was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

INSERT INTO activity_drafts (
  id,
  owner_id,
  status,
  version,
  title,
  summary,
  learning_objectives,
  task_instructions,
  evidence_requirements,
  feedback_criteria,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000030',
  '00000000-0000-4000-8000-000000000001',
  'READY_FOR_PREVIEW',
  1,
  '校园节水行动',
  '用证据形成校园节水建议',
  ARRAY['界定真实问题'],
  '观察、统计并提出建议',
  ARRAY['观察记录'],
  ARRAY['证据与建议对应'],
  now()
);

INSERT INTO activity_draft_revisions (
  id,
  draft_id,
  version,
  source,
  title,
  summary,
  learning_objectives,
  task_instructions,
  evidence_requirements,
  feedback_criteria
)
VALUES (
  '00000000-0000-4000-8000-000000000040',
  '00000000-0000-4000-8000-000000000030',
  1,
  'MANUAL',
  '校园节水行动',
  '用证据形成校园节水建议',
  ARRAY['界定真实问题'],
  '观察、统计并提出建议',
  ARRAY['观察记录'],
  ARRAY['证据与建议对应']
);

-- Build the version-7 fixture through the same dense append-only history that
-- production commands must preserve.
DO $test$
DECLARE
  next_version INTEGER;
BEGIN
  FOR next_version IN 2..7 LOOP
    UPDATE activity_drafts
    SET version = next_version, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000030';

    INSERT INTO activity_draft_revisions (
      id,
      draft_id,
      version,
      source,
      title,
      summary,
      learning_objectives,
      task_instructions,
      evidence_requirements,
      feedback_criteria
    )
    VALUES (
      ('00000000-0000-4000-8000-00000000004' || next_version::text)::uuid,
      '00000000-0000-4000-8000-000000000030',
      next_version,
      'MANUAL',
      '校园节水行动',
      '用证据形成校园节水建议',
      ARRAY['界定真实问题'],
      '观察、统计并提出建议',
      ARRAY['观察记录'],
      ARRAY['证据与建议对应']
    );
  END LOOP;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE activity_drafts
    SET title = '没有新修订的覆盖'
    WHERE id = '00000000-0000-4000-8000-000000000030';
    RAISE EXCEPTION 'draft content changed without advancing its revision';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    DELETE FROM activity_drafts
    WHERE id = '00000000-0000-4000-8000-000000000030';
    RAISE EXCEPTION 'unsealed draft history was deleted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE activity_draft_revisions
    SET title = '不应覆盖'
    WHERE id = '00000000-0000-4000-8000-000000000040';
    RAISE EXCEPTION 'draft revision mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

-- Use an isolated draft to verify the commit-time AgentRun coupling without
-- changing the version-7 release fixture below.
INSERT INTO activity_drafts (
  id,
  owner_id,
  status,
  version,
  title,
  summary,
  learning_objectives,
  task_instructions,
  evidence_requirements,
  feedback_criteria,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000036',
  '00000000-0000-4000-8000-000000000001',
  'READY_FOR_PREVIEW',
  1,
  'Agent 提交约束测试',
  '验证 AgentRun 与不可变修订的提交状态一致',
  ARRAY['验证提交约束'],
  '创建并验证 Agent 修订',
  ARRAY['修订历史'],
  ARRAY['运行状态一致'],
  now()
);

INSERT INTO activity_draft_revisions (
  id,
  draft_id,
  version,
  source,
  title,
  summary,
  learning_objectives,
  task_instructions,
  evidence_requirements,
  feedback_criteria
)
VALUES (
  '00000000-0000-4000-8000-000000000048',
  '00000000-0000-4000-8000-000000000036',
  1,
  'MANUAL',
  'Agent 提交约束测试',
  '验证 AgentRun 与不可变修订的提交状态一致',
  ARRAY['验证提交约束'],
  '创建并验证 Agent 修订',
  ARRAY['修订历史'],
  ARRAY['运行状态一致']
);

DO $test$
BEGIN
  BEGIN
    INSERT INTO agent_runs (id, actor_id, status, model, started_at)
    VALUES (
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000001',
      'RUNNING',
      'test',
      now()
    );

    UPDATE activity_drafts
    SET version = 2, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000036';

    INSERT INTO activity_draft_revisions (
      id,
      draft_id,
      version,
      source,
      title,
      summary,
      learning_objectives,
      task_instructions,
      evidence_requirements,
      feedback_criteria,
      agent_run_id,
      created_at
    )
    SELECT
      '00000000-0000-4000-8000-000000000049',
      draft.id,
      draft.version,
      'AGENT',
      draft.title,
      draft.summary,
      draft.learning_objectives,
      draft.task_instructions,
      draft.evidence_requirements,
      draft.feedback_criteria,
      '00000000-0000-4000-8000-000000000102',
      now()
    FROM activity_drafts AS draft
    WHERE draft.id = '00000000-0000-4000-8000-000000000036';

    SET CONSTRAINTS "activity_draft_revisions_require_succeeded_agent_run" IMMEDIATE;
    RAISE EXCEPTION 'an Agent revision committed while its run remained RUNNING';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO agent_runs (id, actor_id, status, model, started_at)
    VALUES (
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000001',
      'RUNNING',
      'test',
      now()
    );

    UPDATE activity_drafts
    SET version = 2, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000036';

    INSERT INTO activity_draft_revisions (
      id,
      draft_id,
      version,
      source,
      title,
      summary,
      learning_objectives,
      task_instructions,
      evidence_requirements,
      feedback_criteria,
      agent_run_id,
      created_at
    )
    SELECT
      '00000000-0000-4000-8000-00000000004a',
      draft.id,
      draft.version,
      'AGENT',
      draft.title,
      draft.summary,
      draft.learning_objectives,
      draft.task_instructions,
      draft.evidence_requirements,
      draft.feedback_criteria,
      '00000000-0000-4000-8000-000000000103',
      now()
    FROM activity_drafts AS draft
    WHERE draft.id = '00000000-0000-4000-8000-000000000036';

    UPDATE agent_runs
    SET
      status = 'FAILED',
      completed_at = now(),
      failure_code = 'TEST_FAILURE'
    WHERE id = '00000000-0000-4000-8000-000000000103';

    SET CONSTRAINTS "agent_runs_reject_unsuccessful_draft_history" IMMEDIATE;
    RAISE EXCEPTION 'a FAILED AgentRun retained an Agent revision';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO agent_runs (id, actor_id, status, model, started_at)
    VALUES (
      '00000000-0000-4000-8000-000000000104',
      '00000000-0000-4000-8000-000000000001',
      'RUNNING',
      'test',
      now()
    );

    UPDATE activity_drafts
    SET version = 2, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000036';

    INSERT INTO activity_draft_revisions (
      id,
      draft_id,
      version,
      source,
      title,
      summary,
      learning_objectives,
      task_instructions,
      evidence_requirements,
      feedback_criteria,
      agent_run_id,
      created_at
    )
    SELECT
      '00000000-0000-4000-8000-00000000004b',
      draft.id,
      draft.version,
      'AGENT',
      draft.title,
      draft.summary,
      draft.learning_objectives,
      draft.task_instructions,
      draft.evidence_requirements,
      draft.feedback_criteria,
      '00000000-0000-4000-8000-000000000104',
      now()
    FROM activity_drafts AS draft
    WHERE draft.id = '00000000-0000-4000-8000-000000000036';

    UPDATE agent_runs
    SET
      status = 'CANCELLED',
      completed_at = now(),
      failure_code = 'TEST_CANCELLED'
    WHERE id = '00000000-0000-4000-8000-000000000104';

    SET CONSTRAINTS "agent_runs_reject_unsuccessful_draft_history" IMMEDIATE;
    RAISE EXCEPTION 'a CANCELLED AgentRun retained an Agent revision';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

-- One AgentRun may create one draft revision and reach SUCCEEDED in the same
-- transaction. A second revision cannot reuse that still-running provenance;
-- exact command retries return the existing idempotent result instead.
INSERT INTO agent_runs (id, actor_id, status, model, started_at)
VALUES (
  '00000000-0000-4000-8000-000000000105',
  '00000000-0000-4000-8000-000000000001',
  'RUNNING',
  'test',
  now()
);

UPDATE activity_drafts
SET version = 2, updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000036';

INSERT INTO activity_draft_revisions (
  id,
  draft_id,
  version,
  source,
  title,
  summary,
  learning_objectives,
  task_instructions,
  evidence_requirements,
  feedback_criteria,
  agent_run_id,
  created_at
)
SELECT
  '00000000-0000-4000-8000-00000000004c',
  draft.id,
  draft.version,
  'AGENT',
  draft.title,
  draft.summary,
  draft.learning_objectives,
  draft.task_instructions,
  draft.evidence_requirements,
  draft.feedback_criteria,
  '00000000-0000-4000-8000-000000000105',
  now()
FROM activity_drafts AS draft
WHERE draft.id = '00000000-0000-4000-8000-000000000036';

DO $test$
BEGIN
  BEGIN
    UPDATE activity_drafts
    SET version = 3, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000036';

    INSERT INTO activity_draft_revisions (
      id,
      draft_id,
      version,
      source,
      title,
      summary,
      learning_objectives,
      task_instructions,
      evidence_requirements,
      feedback_criteria,
      agent_run_id,
      created_at
    )
    SELECT
      '00000000-0000-4000-8000-00000000004d',
      draft.id,
      draft.version,
      'AGENT',
      draft.title,
      draft.summary,
      draft.learning_objectives,
      draft.task_instructions,
      draft.evidence_requirements,
      draft.feedback_criteria,
      '00000000-0000-4000-8000-000000000105',
      now()
    FROM activity_drafts AS draft
    WHERE draft.id = '00000000-0000-4000-8000-000000000036';

    RAISE EXCEPTION 'one AgentRun created a second draft revision';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$test$;

UPDATE agent_runs
SET status = 'SUCCEEDED', completed_at = now()
WHERE id = '00000000-0000-4000-8000-000000000105';

SET CONSTRAINTS
  "activity_draft_revisions_require_succeeded_agent_run",
  "agent_runs_reject_unsuccessful_draft_history"
  IMMEDIATE;

SET CONSTRAINTS
  "activity_draft_revisions_require_succeeded_agent_run",
  "agent_runs_reject_unsuccessful_draft_history"
  DEFERRED;

DROP TRIGGER "action_intents_publish_due_at_contract" ON action_intents;

WITH legacy_payload AS (
  SELECT jsonb_build_object(
    'draftId', '00000000-0000-4000-8000-000000000030',
    'expectedDraftVersion', 7,
    'classroomId', '00000000-0000-4000-8000-000000000010',
    'dueAt', '2026-08-31T15:59:59.123456+08:00'
  ) AS value
)
INSERT INTO action_intents (
  id,
  actor_id,
  action_name,
  payload,
  payload_hash,
  target_type,
  target_id,
  expected_version,
  expires_at
)
SELECT
  '00000000-0000-4000-8000-000000000077',
  '00000000-0000-4000-8000-000000000001',
  'publish_activity_release',
  legacy_payload.value,
  encode(
    sha256(convert_to("cdas_publish_payload_canonical"(legacy_payload.value), 'UTF8')),
    'hex'
  ),
  'ActivityDraft',
  '00000000-0000-4000-8000-000000000030',
  7,
  now() + interval '10 minutes'
FROM legacy_payload;

CREATE TRIGGER "action_intents_publish_due_at_contract"
BEFORE INSERT ON action_intents
FOR EACH ROW
EXECUTE FUNCTION "enforce_new_publish_due_at_contract"();

UPDATE action_intents
SET status = 'REJECTED', decided_by_id = actor_id, decided_at = now()
WHERE id = '00000000-0000-4000-8000-000000000077';

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM action_intents
    WHERE id = '00000000-0000-4000-8000-000000000077'
      AND status = 'REJECTED'
  ) THEN
    RAISE EXCEPTION 'a pre-upgrade publish intent could not preserve its history transition';
  END IF;
END
$test$;

DO $test$
DECLARE
  invalid_payload JSONB;
BEGIN
  BEGIN
    invalid_payload := jsonb_build_object(
      'draftId', '00000000-0000-4000-8000-000000000030',
      'expectedDraftVersion', 7,
      'classroomId', '00000000-0000-4000-8000-000000000010',
      'dueAt', '2026-08-31 15:59:59'
    );
    INSERT INTO action_intents (
      id,
      actor_id,
      action_name,
      payload,
      payload_hash,
      target_type,
      target_id,
      expected_version,
      expires_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000078',
      '00000000-0000-4000-8000-000000000001',
      'publish_activity_release',
      invalid_payload,
      encode(
        sha256(convert_to("cdas_publish_payload_canonical"(invalid_payload), 'UTF8')),
        'hex'
      ),
      'ActivityDraft',
      '00000000-0000-4000-8000-000000000030',
      7,
      now() + interval '10 minutes'
    );
    RAISE EXCEPTION 'a publish due date without an offset was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    invalid_payload := jsonb_build_object(
      'draftId', '00000000-0000-4000-8000-000000000030',
      'expectedDraftVersion', 7,
      'classroomId', '00000000-0000-4000-8000-000000000010',
      'dueAt', '2026-08-31T15:59:59.123456+08:00'
    );
    INSERT INTO action_intents (
      id,
      actor_id,
      action_name,
      payload,
      payload_hash,
      target_type,
      target_id,
      expected_version,
      expires_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000079',
      '00000000-0000-4000-8000-000000000001',
      'publish_activity_release',
      invalid_payload,
      encode(
        sha256(convert_to("cdas_publish_payload_canonical"(invalid_payload), 'UTF8')),
        'hex'
      ),
      'ActivityDraft',
      '00000000-0000-4000-8000-000000000030',
      7,
      now() + interval '10 minutes'
    );
    RAISE EXCEPTION 'a publish due date with sub-millisecond precision was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

WITH publish_payload AS (
  SELECT jsonb_build_object(
    'draftId', '00000000-0000-4000-8000-000000000030',
    'expectedDraftVersion', 7,
    'classroomId', '00000000-0000-4000-8000-000000000010',
    'dueAt', to_char(
      date_trunc('milliseconds', now() + interval '7 days') AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ) AS value
)
INSERT INTO action_intents (
  id,
  actor_id,
  action_name,
  payload,
  payload_hash,
  target_type,
  target_id,
  expected_version,
  expires_at
)
SELECT
  '00000000-0000-4000-8000-000000000070',
  '00000000-0000-4000-8000-000000000001',
  'publish_activity_release',
  publish_payload.value,
  encode(
    sha256(convert_to("cdas_publish_payload_canonical"(publish_payload.value), 'UTF8')),
    'hex'
  ),
  'ActivityDraft',
  '00000000-0000-4000-8000-000000000030',
  7,
  now() + interval '10 minutes'
FROM publish_payload;

DO $test$
BEGIN
  BEGIN
    UPDATE action_intents
    SET
      payload = '{"draftId":"00000000-0000-4000-8000-000000000031"}'::jsonb,
      payload_hash = repeat('d', 64),
      target_id = '00000000-0000-4000-8000-000000000031',
      expected_version = 8
    WHERE id = '00000000-0000-4000-8000-000000000070';
    RAISE EXCEPTION 'prepared action parameters were replaced';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

UPDATE action_intents
SET
  status = 'CONFIRMED',
  decided_by_id = actor_id,
  decided_at = now()
WHERE id = '00000000-0000-4000-8000-000000000070';

UPDATE action_intents
SET status = 'EXECUTED', executed_at = now()
WHERE id = '00000000-0000-4000-8000-000000000070';

UPDATE activity_drafts
SET status = 'SEALED', sealed_at = now(), updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000030';

INSERT INTO activity_releases (
  id,
  source_draft_id,
  publisher_id,
  classroom_id,
  action_intent_id,
  published_at,
  due_at
)
VALUES (
  '00000000-0000-4000-8000-000000000050',
  '00000000-0000-4000-8000-000000000030',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000070',
  now(),
  date_trunc('milliseconds', now() + interval '7 days')
);

INSERT INTO activity_release_snapshots (
  release_id,
  source_draft_id,
  source_draft_version,
  content,
  content_hash
)
SELECT
  '00000000-0000-4000-8000-000000000050',
  revision.draft_id,
  revision.version,
  jsonb_build_object(
    'schemaVersion', 1,
    'title', revision.title,
    'summary', revision.summary,
    'learningObjectives', to_jsonb(revision.learning_objectives),
    'taskInstructions', revision.task_instructions,
    'evidenceRequirements', to_jsonb(revision.evidence_requirements),
    'feedbackCriteria', to_jsonb(revision.feedback_criteria)
  ),
  encode(
    sha256(convert_to(
      "cdas_activity_content_v1_canonical"(
        revision.title,
        revision.summary,
        revision.learning_objectives,
        revision.task_instructions,
        revision.evidence_requirements,
        revision.feedback_criteria
      ),
      'UTF8'
    )),
    'hex'
  )
FROM activity_draft_revisions AS revision
WHERE revision.draft_id = '00000000-0000-4000-8000-000000000030'
  AND revision.version = 7;

SET CONSTRAINTS
  "activity_releases_integrity",
  "publish_action_intents_require_release",
  "sealed_activity_drafts_require_release"
  IMMEDIATE;

SET CONSTRAINTS
  "activity_releases_integrity",
  "publish_action_intents_require_release",
  "sealed_activity_drafts_require_release"
  DEFERRED;

DO $test$
BEGIN
  BEGIN
    INSERT INTO action_intents (
      id,
      actor_id,
      action_name,
      payload,
      payload_hash,
      target_type,
      target_id,
      expected_version,
      expires_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000071',
      '00000000-0000-4000-8000-000000000001',
      'publish_activity_release',
      jsonb_build_object(
        'draftId', '00000000-0000-4000-8000-000000000036',
        'expectedDraftVersion', 2,
        'classroomId', '00000000-0000-4000-8000-000000000010',
        'dueAt', NULL
      ),
      repeat('a', 64),
      'ActivityDraft',
      '00000000-0000-4000-8000-000000000036',
      2,
      now() + interval '10 minutes'
    );

    UPDATE action_intents
    SET status = 'CONFIRMED', decided_by_id = actor_id, decided_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000071';

    UPDATE action_intents
    SET status = 'EXECUTED', executed_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000071';

    SET CONSTRAINTS "publish_action_intents_require_release" IMMEDIATE;
    RAISE EXCEPTION 'an executed publish intent without a release was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO activity_drafts (
      id,
      owner_id,
      status,
      version,
      title,
      summary,
      learning_objectives,
      task_instructions,
      evidence_requirements,
      feedback_criteria,
      updated_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000037',
      '00000000-0000-4000-8000-000000000001',
      'READY_FOR_PREVIEW',
      1,
      '孤立封存测试',
      '封存必须与发布一起提交',
      ARRAY['验证发布原子性'],
      '确认后发布',
      ARRAY['发布记录'],
      ARRAY['历史完整'],
      now()
    );

    INSERT INTO activity_draft_revisions (
      id,
      draft_id,
      version,
      source,
      title,
      summary,
      learning_objectives,
      task_instructions,
      evidence_requirements,
      feedback_criteria
    )
    VALUES (
      '00000000-0000-4000-8000-00000000004e',
      '00000000-0000-4000-8000-000000000037',
      1,
      'MANUAL',
      '孤立封存测试',
      '封存必须与发布一起提交',
      ARRAY['验证发布原子性'],
      '确认后发布',
      ARRAY['发布记录'],
      ARRAY['历史完整']
    );

    UPDATE activity_drafts
    SET status = 'SEALED', sealed_at = now(), updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000037';

    SET CONSTRAINTS "sealed_activity_drafts_require_release" IMMEDIATE;
    RAISE EXCEPTION 'a sealed activity draft without a release was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
DECLARE
  publish_payload JSONB;
BEGIN
  BEGIN
    publish_payload := jsonb_build_object(
      'draftId', '00000000-0000-4000-8000-000000000036',
      'expectedDraftVersion', 2,
      'classroomId', '00000000-0000-4000-8000-000000000010',
      'dueAt', NULL
    );

    INSERT INTO action_intents (
      id,
      actor_id,
      action_name,
      payload,
      payload_hash,
      target_type,
      target_id,
      expected_version,
      expires_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000072',
      '00000000-0000-4000-8000-000000000001',
      'publish_activity_release',
      publish_payload,
      repeat('0', 64),
      'ActivityDraft',
      '00000000-0000-4000-8000-000000000036',
      2,
      now() + interval '10 minutes'
    );

    UPDATE action_intents
    SET status = 'CONFIRMED', decided_by_id = actor_id, decided_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000072';

    UPDATE action_intents
    SET status = 'EXECUTED', executed_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000072';

    UPDATE activity_drafts
    SET status = 'SEALED', sealed_at = now(), updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000036';

    INSERT INTO activity_releases (
      id,
      source_draft_id,
      publisher_id,
      classroom_id,
      action_intent_id,
      published_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000052',
      '00000000-0000-4000-8000-000000000036',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000072',
      now()
    );

    INSERT INTO activity_release_snapshots (
      release_id,
      source_draft_id,
      source_draft_version,
      content,
      content_hash
    )
    SELECT
      '00000000-0000-4000-8000-000000000052',
      revision.draft_id,
      revision.version,
      jsonb_build_object(
        'schemaVersion', 1,
        'title', revision.title,
        'summary', revision.summary,
        'learningObjectives', to_jsonb(revision.learning_objectives),
        'taskInstructions', revision.task_instructions,
        'evidenceRequirements', to_jsonb(revision.evidence_requirements),
        'feedbackCriteria', to_jsonb(revision.feedback_criteria)
      ),
      encode(
        sha256(convert_to(
          "cdas_activity_content_v1_canonical"(
            revision.title,
            revision.summary,
            revision.learning_objectives,
            revision.task_instructions,
            revision.evidence_requirements,
            revision.feedback_criteria
          ),
          'UTF8'
        )),
        'hex'
      )
    FROM activity_draft_revisions AS revision
    WHERE revision.draft_id = '00000000-0000-4000-8000-000000000036'
      AND revision.version = 2;

    SET CONSTRAINTS
      "activity_releases_integrity",
      "publish_action_intents_require_release",
      "sealed_activity_drafts_require_release"
      IMMEDIATE;
    RAISE EXCEPTION 'a release with a forged publish payload hash was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
DECLARE
  publish_payload JSONB;
BEGIN
  BEGIN
    publish_payload := jsonb_build_object(
      'draftId', '00000000-0000-4000-8000-000000000036',
      'expectedDraftVersion', 2,
      'classroomId', '00000000-0000-4000-8000-000000000010',
      'dueAt', NULL
    );

    INSERT INTO action_intents (
      id,
      actor_id,
      action_name,
      payload,
      payload_hash,
      target_type,
      target_id,
      expected_version,
      expires_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000072',
      '00000000-0000-4000-8000-000000000001',
      'publish_activity_release',
      publish_payload,
      encode(
        sha256(convert_to("cdas_publish_payload_canonical"(publish_payload), 'UTF8')),
        'hex'
      ),
      'ActivityDraft',
      '00000000-0000-4000-8000-000000000036',
      2,
      now() + interval '10 minutes'
    );

    UPDATE action_intents
    SET status = 'CONFIRMED', decided_by_id = actor_id, decided_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000072';

    UPDATE action_intents
    SET status = 'EXECUTED', executed_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000072';

    UPDATE activity_drafts
    SET status = 'SEALED', sealed_at = now(), updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000036';

    INSERT INTO activity_releases (
      id,
      source_draft_id,
      publisher_id,
      classroom_id,
      action_intent_id,
      published_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000052',
      '00000000-0000-4000-8000-000000000036',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000072',
      now()
    );

    INSERT INTO activity_release_snapshots (
      release_id,
      source_draft_id,
      source_draft_version,
      content,
      content_hash
    )
    SELECT
      '00000000-0000-4000-8000-000000000052',
      revision.draft_id,
      revision.version,
      jsonb_build_object(
        'schemaVersion', 1,
        'title', revision.title || '伪造',
        'summary', revision.summary,
        'learningObjectives', to_jsonb(revision.learning_objectives),
        'taskInstructions', revision.task_instructions,
        'evidenceRequirements', to_jsonb(revision.evidence_requirements),
        'feedbackCriteria', to_jsonb(revision.feedback_criteria)
      ),
      repeat('f', 64)
    FROM activity_draft_revisions AS revision
    WHERE revision.draft_id = '00000000-0000-4000-8000-000000000036'
      AND revision.version = 2;

    SET CONSTRAINTS
      "activity_releases_integrity",
      "publish_action_intents_require_release",
      "sealed_activity_drafts_require_release"
      IMMEDIATE;
    RAISE EXCEPTION 'a release with forged snapshot content and hash was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

SET CONSTRAINTS
  "activity_releases_integrity",
  "publish_action_intents_require_release",
  "sealed_activity_drafts_require_release"
  DEFERRED;

DO $test$
BEGIN
  BEGIN
    UPDATE activity_release_snapshots
    SET content = '{"schemaVersion": 2}'::jsonb
    WHERE release_id = '00000000-0000-4000-8000-000000000050';
    RAISE EXCEPTION 'release snapshot mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE activity_releases
    SET published_at = published_at + interval '1 minute'
    WHERE id = '00000000-0000-4000-8000-000000000050';
    RAISE EXCEPTION 'published release time mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

WITH close_payload AS (
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'releaseId', '00000000-0000-4000-8000-000000000050',
    'expectedStatus', 'ACTIVE'
  ) AS value
)
INSERT INTO action_intents (
  id,
  actor_id,
  action_name,
  payload,
  payload_hash,
  target_type,
  target_id,
  expected_version,
  expires_at
)
SELECT
  '00000000-0000-4000-8000-000000000073',
  '00000000-0000-4000-8000-000000000001',
  'close_activity_release',
  close_payload.value,
  encode(
    sha256(convert_to("cdas_close_release_payload_canonical"(close_payload.value), 'UTF8')),
    'hex'
  ),
  'ActivityRelease',
  '00000000-0000-4000-8000-000000000050',
  NULL,
  now() + interval '10 minutes'
FROM close_payload;

UPDATE action_intents
SET status = 'CONFIRMED', decided_by_id = actor_id, decided_at = now()
WHERE id = '00000000-0000-4000-8000-000000000073';

UPDATE action_intents
SET status = 'EXECUTED', executed_at = now() + interval '1 minute'
WHERE id = '00000000-0000-4000-8000-000000000073';

UPDATE activity_releases
SET
  status = 'CLOSED',
  closed_at = published_at + interval '1 minute',
  close_action_intent_id = '00000000-0000-4000-8000-000000000073'
WHERE id = '00000000-0000-4000-8000-000000000050';

INSERT INTO action_audits (
  id,
  actor_id,
  action_intent_id,
  source,
  action_name,
  target_type,
  target_id,
  request_hash,
  outcome,
  result_resource_id,
  trace_id
)
VALUES (
  '00000000-0000-4000-8000-000000000062',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000073',
  'UI',
  'close_activity_release',
  'ActivityRelease',
  '00000000-0000-4000-8000-000000000050',
  repeat('b', 64),
  'SUCCEEDED',
  '00000000-0000-4000-8000-000000000050',
  'close-migration-invariant-test'
);

SET CONSTRAINTS
  "activity_releases_close_integrity",
  "close_action_intents_require_release"
  IMMEDIATE;

SET CONSTRAINTS
  "activity_releases_close_integrity",
  "close_action_intents_require_release"
  DEFERRED;

DO $test$
BEGIN
  BEGIN
    UPDATE activity_releases
    SET status = 'ACTIVE', closed_at = NULL
    WHERE id = '00000000-0000-4000-8000-000000000050';
    RAISE EXCEPTION 'closed release was reopened';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE activity_drafts
    SET title = '不应修改已封存草稿', updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000030';
    RAISE EXCEPTION 'sealed activity draft mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE action_intents
    SET
      status = 'PREPARED',
      decided_by_id = NULL,
      decided_at = NULL,
      executed_at = NULL
    WHERE id = '00000000-0000-4000-8000-000000000070';
    RAISE EXCEPTION 'executed action intent was reopened';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO activity_releases (
      id,
      source_draft_id,
      publisher_id,
      classroom_id,
      action_intent_id,
      due_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000051',
      '00000000-0000-4000-8000-000000000030',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000070',
      now() - interval '1 second'
    );
    RAISE EXCEPTION 'expired due date was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

INSERT INTO submissions (
  id,
  release_id,
  student_id,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000080',
  '00000000-0000-4000-8000-000000000050',
  '00000000-0000-4000-8000-000000000002',
  now()
);

DO $test$
BEGIN
  BEGIN
    UPDATE submissions
    SET phase_index = 1, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000080';
    RAISE EXCEPTION 'submission phase identity was changed';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO submissions (
      id,
      release_id,
      student_id,
      phase_index,
      updated_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000088',
      '00000000-0000-4000-8000-000000000050',
      '00000000-0000-4000-8000-000000000002',
      1,
      now()
    );
    RAISE EXCEPTION 'whole-task release accepted a phase submission';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

INSERT INTO submission_working_copies (
  id,
  submission_id,
  text_evidence,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000081',
  '00000000-0000-4000-8000-000000000080',
  '水表记录显示用水量下降。',
  now()
);

DO $test$
BEGIN
  BEGIN
    INSERT INTO submission_attachments (
      id,
      submission_id,
      student_id,
      kind,
      original_filename,
      media_type,
      byte_size,
      storage_key
    )
    VALUES (
      '00000000-0000-4000-8000-000000000089',
      '00000000-0000-4000-8000-000000000080',
      '00000000-0000-4000-8000-000000000001',
      'PDF',
      '越权.pdf',
      'application/pdf',
      1024,
      'submission/owner-mismatch'
    );
    RAISE EXCEPTION 'attachment ownership mismatch was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

INSERT INTO submission_attachments (
  id,
  submission_id,
  student_id,
  kind,
  original_filename,
  media_type,
  byte_size,
  storage_key
)
VALUES
  (
    '00000000-0000-4000-8000-000000000086',
    '00000000-0000-4000-8000-000000000080',
    '00000000-0000-4000-8000-000000000002',
    'IMAGE',
    '观察.jpg',
    'image/jpeg',
    1024,
    'submission/ready-image'
  ),
  (
    '00000000-0000-4000-8000-000000000087',
    '00000000-0000-4000-8000-000000000080',
    '00000000-0000-4000-8000-000000000002',
    'PDF',
    '记录.pdf',
    'application/pdf',
    2048,
    'submission/scanning-pdf'
  );

UPDATE submission_attachments
SET status = 'SCAN_PENDING', uploaded_at = now()
WHERE id IN (
  '00000000-0000-4000-8000-000000000086',
  '00000000-0000-4000-8000-000000000087'
);

UPDATE submission_attachments
SET status = 'READY', scanned_at = now()
WHERE id = '00000000-0000-4000-8000-000000000086';

INSERT INTO submission_working_copy_attachments (
  working_copy_id,
  attachment_id,
  position
)
VALUES
  (
    '00000000-0000-4000-8000-000000000081',
    '00000000-0000-4000-8000-000000000086',
    0
  ),
  (
    '00000000-0000-4000-8000-000000000081',
    '00000000-0000-4000-8000-000000000087',
    1
  );

DO $test$
BEGIN
  BEGIN
    DELETE FROM submission_working_copies
    WHERE id = '00000000-0000-4000-8000-000000000081';
    RAISE EXCEPTION 'unsubmitted working copy deletion was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE submissions
    SET latest_revision_number = 1, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000080';

    INSERT INTO submission_revisions (
      id,
      submission_id,
      revision_number,
      base_revision_number,
      source_working_copy_id,
      source_working_version,
      text_evidence,
      is_late,
      submitted_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000083',
      '00000000-0000-4000-8000-000000000080',
      1,
      0,
      '00000000-0000-4000-8000-000000000099',
      77,
      '伪造的正式证据',
      false,
      now()
    );
    RAISE EXCEPTION 'formal revision without an exact working copy was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

UPDATE submissions
SET latest_revision_number = 1, updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000080';

INSERT INTO submission_revisions (
  id,
  submission_id,
  revision_number,
  base_revision_number,
  source_working_copy_id,
  source_working_version,
  text_evidence,
  is_late,
  submitted_at
)
VALUES (
  '00000000-0000-4000-8000-000000000082',
  '00000000-0000-4000-8000-000000000080',
  1,
  0,
  '00000000-0000-4000-8000-000000000081',
  1,
  '水表记录显示用水量下降。',
  false,
  now()
);

INSERT INTO submission_revision_attachments (
  submission_revision_id,
  attachment_id,
  position
)
VALUES (
  '00000000-0000-4000-8000-000000000082',
  '00000000-0000-4000-8000-000000000086',
  0
);

DO $test$
BEGIN
  BEGIN
    INSERT INTO submission_revision_attachments (
      submission_revision_id,
      attachment_id,
      position
    )
    VALUES (
      '00000000-0000-4000-8000-000000000082',
      '00000000-0000-4000-8000-000000000087',
      1
    );
    RAISE EXCEPTION 'unscanned attachment entered formal history';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

UPDATE submission_attachments
SET status = 'READY', scanned_at = now()
WHERE id = '00000000-0000-4000-8000-000000000087';

INSERT INTO submission_revision_attachments (
  submission_revision_id,
  attachment_id,
  position
)
VALUES (
  '00000000-0000-4000-8000-000000000082',
  '00000000-0000-4000-8000-000000000087',
  1
);

DELETE FROM submission_working_copy_attachments
WHERE working_copy_id = '00000000-0000-4000-8000-000000000081';

DELETE FROM submission_working_copies
WHERE id = '00000000-0000-4000-8000-000000000081';

DO $test$
BEGIN
  BEGIN
    UPDATE submission_revision_attachments
    SET position = 2
    WHERE submission_revision_id = '00000000-0000-4000-8000-000000000082'
      AND attachment_id = '00000000-0000-4000-8000-000000000086';
    RAISE EXCEPTION 'formal attachment position was rewritten';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    DELETE FROM submission_revision_attachments
    WHERE submission_revision_id = '00000000-0000-4000-8000-000000000082'
      AND attachment_id = '00000000-0000-4000-8000-000000000086';
    RAISE EXCEPTION 'formal attachment history was deleted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    UPDATE submission_attachments
    SET status = 'REJECTED'
    WHERE id = '00000000-0000-4000-8000-000000000086';
    RAISE EXCEPTION 'ready attachment lifecycle moved backwards';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO submission_working_copies (
      id,
      submission_id,
      base_revision_number,
      version,
      text_evidence,
      updated_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000081',
      '00000000-0000-4000-8000-000000000080',
      1,
      1,
      '不应复用已消费的工作副本标识',
      now()
    );
    RAISE EXCEPTION 'consumed working-copy identity was reused';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE submissions
    SET latest_revision_number = 0, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000080';
    RAISE EXCEPTION 'submission latest revision moved backwards';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE submissions
    SET student_id = '00000000-0000-4000-8000-000000000001', updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000080';
    RAISE EXCEPTION 'submission ownership was reassigned';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE submission_revisions
    SET text_evidence = '不应覆盖正式证据'
    WHERE id = '00000000-0000-4000-8000-000000000082';
    RAISE EXCEPTION 'submission revision mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

INSERT INTO action_intents (
  id,
  actor_id,
  action_name,
  payload,
  payload_hash,
  target_type,
  target_id,
  expected_version,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000000090',
  '00000000-0000-4000-8000-000000000001',
  'save_teacher_feedback',
  '{
    "schemaVersion": 2,
    "submissionId": "00000000-0000-4000-8000-000000000080",
    "submissionRevisionId": "00000000-0000-4000-8000-000000000082",
    "expectedSubmissionRevisionNumber": 1,
    "expectedFeedbackVersion": 0,
    "body": "证据清楚，请补充测量时间。",
    "nextStep": "REVISE",
    "supportLevel": "FOUNDATION",
    "suggestionAgentRunId": null
  }'::jsonb,
  repeat('e', 64),
  'Submission',
  '00000000-0000-4000-8000-000000000080',
  1,
  now() + interval '10 minutes'
);

UPDATE action_intents
SET status = 'CONFIRMED', decided_by_id = actor_id, decided_at = now()
WHERE id = '00000000-0000-4000-8000-000000000090';

UPDATE action_intents
SET status = 'EXECUTED', executed_at = now()
WHERE id = '00000000-0000-4000-8000-000000000090';

INSERT INTO teacher_feedback (
  id,
  submission_revision_id,
  teacher_id,
  version,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000091',
  '00000000-0000-4000-8000-000000000082',
  '00000000-0000-4000-8000-000000000001',
  1,
  now()
);

INSERT INTO teacher_feedback_revisions (
  id,
  teacher_feedback_id,
  version,
  body,
  body_hash,
  next_step,
  support_level,
  source,
  confirmed_by_id,
  action_intent_id,
  confirmed_at
)
VALUES (
  '00000000-0000-4000-8000-000000000092',
  '00000000-0000-4000-8000-000000000091',
  1,
  '证据清楚，请补充测量时间。',
  repeat('f', 64),
  'REVISE',
  'FOUNDATION',
  'MANUAL',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000090',
  now()
);

DO $test$
BEGIN
  BEGIN
    UPDATE teacher_feedback_revisions
    SET body = '不应覆盖已确认反馈'
    WHERE id = '00000000-0000-4000-8000-000000000092';
    RAISE EXCEPTION 'feedback revision mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE teacher_feedback
    SET teacher_id = '00000000-0000-4000-8000-000000000002', updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000091';
    RAISE EXCEPTION 'feedback identity was reassigned';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE teacher_feedback
    SET version = 3, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000091';
    RAISE EXCEPTION 'feedback version skipped a revision';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

-- A later student revision is allowed and turns the earlier feedback into
-- history, but that old feedback can no longer be revised as if it were current.
INSERT INTO submission_working_copies (
  id,
  submission_id,
  base_revision_number,
  version,
  text_evidence,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-000000000084',
  '00000000-0000-4000-8000-000000000080',
  1,
  1,
  '第二版证据补充了测量时间。',
  now()
);

UPDATE submissions
SET latest_revision_number = 2, updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000080';

INSERT INTO submission_revisions (
  id,
  submission_id,
  revision_number,
  base_revision_number,
  source_working_copy_id,
  source_working_version,
  text_evidence,
  is_late,
  submitted_at
)
VALUES (
  '00000000-0000-4000-8000-000000000085',
  '00000000-0000-4000-8000-000000000080',
  2,
  1,
  '00000000-0000-4000-8000-000000000084',
  1,
  '第二版证据补充了测量时间。',
  false,
  now()
);

DELETE FROM submission_working_copies
WHERE id = '00000000-0000-4000-8000-000000000084';

DO $test$
BEGIN
  BEGIN
    UPDATE teacher_feedback
    SET version = 2, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-000000000091';
    RAISE EXCEPTION 'feedback for a historical submission was revised';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

-- Schema v1 snapshots have no four-level rubric, so a current v1 revision
-- cannot receive an evidence-bound evaluation even with a well-formed payload.
INSERT INTO action_intents (
  id,
  actor_id,
  action_name,
  payload,
  payload_hash,
  target_type,
  target_id,
  expected_version,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-0000000000ca',
  '00000000-0000-4000-8000-000000000001',
  'save_teacher_evaluation',
  '{
    "schemaVersion": 1,
    "submissionId": "00000000-0000-4000-8000-000000000080",
    "submissionRevisionId": "00000000-0000-4000-8000-000000000085",
    "expectedSubmissionRevisionNumber": 2,
    "expectedEvaluationVersion": 0,
    "summary": "v1 快照不应接受量规评价。",
    "outcomes": [
      {"dimensionIndex":1,"dimensionName":"问题意识","status":"LEVEL","level":"good","citations":[{"kind":"text"}]},
      {"dimensionIndex":2,"dimensionName":"证据质量","status":"LEVEL","level":"good","citations":[{"kind":"text"}]},
      {"dimensionIndex":3,"dimensionName":"跨学科连接","status":"LEVEL","level":"good","citations":[{"kind":"text"}]},
      {"dimensionIndex":4,"dimensionName":"方案表达","status":"LEVEL","level":"good","citations":[{"kind":"text"}]}
    ],
    "suggestionAgentRunId": null
  }'::jsonb,
  repeat('c', 64),
  'Submission',
  '00000000-0000-4000-8000-000000000080',
  2,
  now() + interval '10 minutes'
);

UPDATE action_intents
SET status = 'CONFIRMED', decided_by_id = actor_id, decided_at = now()
WHERE id = '00000000-0000-4000-8000-0000000000ca';

UPDATE action_intents
SET status = 'EXECUTED', executed_at = now()
WHERE id = '00000000-0000-4000-8000-0000000000ca';

DO $test$
BEGIN
  BEGIN
    INSERT INTO teacher_evaluations (
      id,
      submission_revision_id,
      teacher_id,
      version,
      updated_at
    )
    VALUES (
      '00000000-0000-4000-8000-0000000000cb',
      '00000000-0000-4000-8000-000000000085',
      '00000000-0000-4000-8000-000000000001',
      1,
      now()
    );

    INSERT INTO teacher_evaluation_revisions (
      id,
      teacher_evaluation_id,
      version,
      summary,
      summary_hash,
      outcomes,
      source,
      confirmed_by_id,
      action_intent_id,
      confirmed_at
    )
    VALUES (
      '00000000-0000-4000-8000-0000000000cc',
      '00000000-0000-4000-8000-0000000000cb',
      1,
      'v1 快照不应接受量规评价。',
      encode(sha256(convert_to('v1 快照不应接受量规评价。', 'UTF8')), 'hex'),
      '[
        {"dimensionIndex":1,"dimensionName":"问题意识","status":"LEVEL","level":"good","citations":[{"kind":"text"}]},
        {"dimensionIndex":2,"dimensionName":"证据质量","status":"LEVEL","level":"good","citations":[{"kind":"text"}]},
        {"dimensionIndex":3,"dimensionName":"跨学科连接","status":"LEVEL","level":"good","citations":[{"kind":"text"}]},
        {"dimensionIndex":4,"dimensionName":"方案表达","status":"LEVEL","level":"good","citations":[{"kind":"text"}]}
      ]'::jsonb,
      'MANUAL',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-0000000000ca',
      now()
    );
    RAISE EXCEPTION 'schema v1 snapshot accepted an evidence-bound evaluation';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

WITH evaluation_task_book AS (
  SELECT $json$
  {
    "schemaVersion": 2,
    "title": "量规评价测试活动",
    "topic": "校园节水",
    "summary": "从真实现象形成证据与建议。",
    "schoolStage": "MIDDLE",
    "grade": 7,
    "mainDisciplineCode": "physics",
    "integratedDisciplineCodes": ["math", "chinese"],
    "crossDisciplinaryConceptCodes": ["system_model"],
    "assignmentType": "inquiry",
    "assignmentSubtype": "survey",
    "inquiryDepth": "deep",
    "submissionMode": "once",
    "durationWeeks": 2,
    "backgroundSetting": "学校需要同学们提出有证据的节水建议。",
    "objectiveKnowledge": "理解校园用水与资源节约的关系。",
    "objectiveProcess": "使用观察和统计形成判断。",
    "objectiveEmotion": "愿意为公共资源负责。",
    "learningObjectives": ["理解校园用水与资源节约的关系。", "使用观察和统计形成判断。", "愿意为公共资源负责。"],
    "taskInstructions": "完成观察、分析和公开建议。",
    "evidenceRequirements": ["观察记录", "统计表", "建议稿"],
    "feedbackCriteria": ["问题意识", "证据质量", "跨学科连接", "方案表达"],
    "phases": [
      {"name":"观察","action":"观察场景。","context":"选择真实地点。","support":"使用记录表。","evidence":[{"type":"text","description":"观察记录"}],"evaluationFocus":"问题清楚。","suggestedLessons":1},
      {"name":"分析","action":"分析数据。","context":"比较记录。","support":"使用统计表。","evidence":[{"type":"document","description":"统计表"}],"evaluationFocus":"证据可靠。","suggestedLessons":1},
      {"name":"表达","action":"提出建议。","context":"面向真实对象。","support":"按证据组织表达。","evidence":[{"type":"text","description":"建议稿"}],"evaluationFocus":"建议可行。","suggestedLessons":1}
    ],
    "rubricDimensions": [
      {"name":"问题意识","excellent":"清楚可查。","good":"较清楚。","pass":"基本相关。","improve":"问题不清。"},
      {"name":"证据质量","excellent":"完整可靠。","good":"较充分。","pass":"有证据。","improve":"证据不足。"},
      {"name":"跨学科连接","excellent":"连接清楚。","good":"使用两科。","pass":"使用一科。","improve":"没有连接。"},
      {"name":"方案表达","excellent":"具体可行。","good":"较具体。","pass":"有建议。","improve":"建议空泛。"}
    ]
  }
  $json$::JSONB AS value
)
INSERT INTO activity_drafts (
  id, owner_id, status, version, schema_version, task_book,
  title, summary, learning_objectives, task_instructions,
  evidence_requirements, feedback_criteria, updated_at
)
SELECT
  '00000000-0000-4000-8000-0000000000c0',
  '00000000-0000-4000-8000-000000000001',
  'READY_FOR_PREVIEW',
  1,
  2,
  evaluation_task_book.value,
  evaluation_task_book.value ->> 'title',
  evaluation_task_book.value ->> 'summary',
  ARRAY(SELECT jsonb_array_elements_text(evaluation_task_book.value -> 'learningObjectives')),
  evaluation_task_book.value ->> 'taskInstructions',
  ARRAY(SELECT jsonb_array_elements_text(evaluation_task_book.value -> 'evidenceRequirements')),
  ARRAY(SELECT jsonb_array_elements_text(evaluation_task_book.value -> 'feedbackCriteria')),
  now()
FROM evaluation_task_book;

INSERT INTO activity_draft_revisions (
  id, draft_id, version, source, schema_version, task_book,
  title, summary, learning_objectives, task_instructions,
  evidence_requirements, feedback_criteria
)
SELECT
  '00000000-0000-4000-8000-0000000000c1',
  draft.id,
  draft.version,
  'MANUAL',
  draft.schema_version,
  draft.task_book,
  draft.title,
  draft.summary,
  draft.learning_objectives,
  draft.task_instructions,
  draft.evidence_requirements,
  draft.feedback_criteria
FROM activity_drafts AS draft
WHERE draft.id = '00000000-0000-4000-8000-0000000000c0';

WITH publish_payload AS (
  SELECT jsonb_build_object(
    'draftId', '00000000-0000-4000-8000-0000000000c0',
    'expectedDraftVersion', 1,
    'classroomId', '00000000-0000-4000-8000-000000000010',
    'dueAt', NULL
  ) AS value
)
INSERT INTO action_intents (
  id,
  actor_id,
  action_name,
  payload,
  payload_hash,
  target_type,
  target_id,
  expected_version,
  expires_at
)
SELECT
  '00000000-0000-4000-8000-0000000000c2',
  '00000000-0000-4000-8000-000000000001',
  'publish_activity_release',
  publish_payload.value,
  encode(
    sha256(convert_to("cdas_publish_payload_canonical"(publish_payload.value), 'UTF8')),
    'hex'
  ),
  'ActivityDraft',
  '00000000-0000-4000-8000-0000000000c0',
  1,
  now() + interval '10 minutes'
FROM publish_payload;

UPDATE action_intents
SET status = 'CONFIRMED', decided_by_id = actor_id, decided_at = now()
WHERE id = '00000000-0000-4000-8000-0000000000c2';

UPDATE action_intents
SET status = 'EXECUTED', executed_at = now()
WHERE id = '00000000-0000-4000-8000-0000000000c2';

UPDATE activity_drafts
SET status = 'SEALED', sealed_at = now(), updated_at = now()
WHERE id = '00000000-0000-4000-8000-0000000000c0';

INSERT INTO activity_releases (
  id,
  source_draft_id,
  publisher_id,
  classroom_id,
  action_intent_id,
  execution_version,
  published_at,
  due_at
)
SELECT
  '00000000-0000-4000-8000-0000000000c3',
  '00000000-0000-4000-8000-0000000000c0',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-0000000000c2',
  0,
  intent.executed_at,
  NULL
FROM action_intents AS intent
WHERE intent.id = '00000000-0000-4000-8000-0000000000c2';

INSERT INTO activity_release_snapshots (
  release_id,
  source_draft_id,
  source_draft_version,
  schema_version,
  content,
  content_hash
)
SELECT
  '00000000-0000-4000-8000-0000000000c3',
  revision.draft_id,
  revision.version,
  2,
  revision.task_book,
  encode(sha256(convert_to(revision.task_book::TEXT, 'UTF8')), 'hex')
FROM activity_draft_revisions AS revision
WHERE revision.id = '00000000-0000-4000-8000-0000000000c1';

SET CONSTRAINTS
  "activity_releases_integrity",
  "publish_action_intents_require_release",
  "sealed_activity_drafts_require_release"
  IMMEDIATE;

SET CONSTRAINTS
  "activity_releases_integrity",
  "publish_action_intents_require_release",
  "sealed_activity_drafts_require_release"
  DEFERRED;

INSERT INTO submissions (
  id,
  release_id,
  student_id,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-0000000000c4',
  '00000000-0000-4000-8000-0000000000c3',
  '00000000-0000-4000-8000-000000000002',
  now()
);

INSERT INTO submission_working_copies (
  id,
  submission_id,
  base_revision_number,
  version,
  text_evidence,
  updated_at
)
VALUES (
  '00000000-0000-4000-8000-0000000000c5',
  '00000000-0000-4000-8000-0000000000c4',
  0,
  1,
  '观察记录：午间饮水区持续流水。',
  now()
);

UPDATE submissions
SET latest_revision_number = 1, updated_at = now()
WHERE id = '00000000-0000-4000-8000-0000000000c4';

INSERT INTO submission_revisions (
  id,
  submission_id,
  revision_number,
  base_revision_number,
  source_working_copy_id,
  source_working_version,
  text_evidence,
  is_late,
  submitted_at
)
VALUES (
  '00000000-0000-4000-8000-0000000000c6',
  '00000000-0000-4000-8000-0000000000c4',
  1,
  0,
  '00000000-0000-4000-8000-0000000000c5',
  1,
  '观察记录：午间饮水区持续流水。',
  false,
  now()
);

DELETE FROM submission_working_copies
WHERE id = '00000000-0000-4000-8000-0000000000c5';

INSERT INTO action_intents (
  id,
  actor_id,
  action_name,
  payload,
  payload_hash,
  target_type,
  target_id,
  expected_version,
  expires_at
)
VALUES (
  '00000000-0000-4000-8000-0000000000c7',
  '00000000-0000-4000-8000-000000000001',
  'save_teacher_evaluation',
  '{
    "schemaVersion": 1,
    "submissionId": "00000000-0000-4000-8000-0000000000c4",
    "submissionRevisionId": "00000000-0000-4000-8000-0000000000c6",
    "expectedSubmissionRevisionNumber": 1,
    "expectedEvaluationVersion": 0,
    "summary": "证据能支持四个维度的判断。",
    "outcomes": [
      {"dimensionIndex":1,"dimensionName":"问题意识","status":"LEVEL","level":"good","citations":[{"kind":"text"}]},
      {"dimensionIndex":2,"dimensionName":"证据质量","status":"INSUFFICIENT_EVIDENCE","citations":[]},
      {"dimensionIndex":3,"dimensionName":"跨学科连接","status":"LEVEL","level":"pass","citations":[{"kind":"text"}]},
      {"dimensionIndex":4,"dimensionName":"方案表达","status":"LEVEL","level":"good","citations":[{"kind":"text"}]}
    ],
    "suggestionAgentRunId": null
  }'::jsonb,
  repeat('d', 64),
  'Submission',
  '00000000-0000-4000-8000-0000000000c4',
  1,
  now() + interval '10 minutes'
);

UPDATE action_intents
SET status = 'CONFIRMED', decided_by_id = actor_id, decided_at = now()
WHERE id = '00000000-0000-4000-8000-0000000000c7';

UPDATE action_intents
SET status = 'EXECUTED', executed_at = now()
WHERE id = '00000000-0000-4000-8000-0000000000c7';

INSERT INTO teacher_evaluations (
  id,
  submission_revision_id,
  teacher_id,
  version,
  created_at,
  updated_at
)
SELECT
  '00000000-0000-4000-8000-0000000000c8',
  '00000000-0000-4000-8000-0000000000c6',
  '00000000-0000-4000-8000-000000000001',
  1,
  intent.executed_at,
  intent.executed_at
FROM action_intents AS intent
WHERE intent.id = '00000000-0000-4000-8000-0000000000c7';

INSERT INTO teacher_evaluation_revisions (
  id,
  teacher_evaluation_id,
  version,
  summary,
  summary_hash,
  outcomes,
  source,
  confirmed_by_id,
  action_intent_id,
  confirmed_at
)
SELECT
  '00000000-0000-4000-8000-0000000000c9',
  '00000000-0000-4000-8000-0000000000c8',
  1,
  '证据能支持四个维度的判断。',
  encode(sha256(convert_to('证据能支持四个维度的判断。', 'UTF8')), 'hex'),
  '[
    {"dimensionIndex":1,"dimensionName":"问题意识","status":"LEVEL","level":"good","citations":[{"kind":"text"}]},
    {"dimensionIndex":2,"dimensionName":"证据质量","status":"INSUFFICIENT_EVIDENCE","citations":[]},
    {"dimensionIndex":3,"dimensionName":"跨学科连接","status":"LEVEL","level":"pass","citations":[{"kind":"text"}]},
    {"dimensionIndex":4,"dimensionName":"方案表达","status":"LEVEL","level":"good","citations":[{"kind":"text"}]}
  ]'::jsonb,
  'MANUAL',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-0000000000c7',
  intent.executed_at
FROM action_intents AS intent
WHERE intent.id = '00000000-0000-4000-8000-0000000000c7';

DO $test$
BEGIN
  BEGIN
    UPDATE teacher_evaluation_revisions
    SET summary = '不应覆盖已确认评价'
    WHERE id = '00000000-0000-4000-8000-0000000000c9';
    RAISE EXCEPTION 'evaluation revision mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE teacher_evaluations
    SET teacher_id = '00000000-0000-4000-8000-000000000002', updated_at = now()
    WHERE id = '00000000-0000-4000-8000-0000000000c8';
    RAISE EXCEPTION 'evaluation identity was reassigned';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE teacher_evaluations
    SET version = 3, updated_at = now()
    WHERE id = '00000000-0000-4000-8000-0000000000c8';
    RAISE EXCEPTION 'evaluation version skipped a revision';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

INSERT INTO action_audits (
  id,
  actor_id,
  source,
  action_name,
  target_type,
  target_id,
  request_hash,
  outcome,
  trace_id
)
VALUES (
  '00000000-0000-4000-8000-000000000060',
  '00000000-0000-4000-8000-000000000001',
  'UI',
  'publish_activity_release',
  'ActivityRelease',
  '00000000-0000-4000-8000-000000000050',
  repeat('b', 64),
  'SUCCEEDED',
  'migration-invariant-test'
);

DO $test$
BEGIN
  BEGIN
    DELETE FROM action_audits
    WHERE id = '00000000-0000-4000-8000-000000000060';
    RAISE EXCEPTION 'audit deletion was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

INSERT INTO schools (
  id,
  name,
  code,
  teacher_invite_code_hash,
  status,
  updated_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000901',
    '学校 A',
    'SCH2ABCD',
    repeat('a', 64),
    'ACTIVE',
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000902',
    '学校 B',
    'SCH3EFGH',
    repeat('b', 64),
    'ACTIVE',
    now()
  );

INSERT INTO app_users (
  id,
  auth_subject,
  role,
  display_name,
  school_id,
  staff_no,
  student_no,
  legacy_profile,
  updated_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000911',
    'school_a_teacher',
    'TEACHER',
    '学校 A 教师',
    '00000000-0000-4000-8000-000000000901',
    'T001',
    NULL,
    false,
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000912',
    'school_b_teacher',
    'TEACHER',
    '学校 B 教师',
    '00000000-0000-4000-8000-000000000902',
    'T001',
    NULL,
    false,
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000913',
    'school_b_student',
    'STUDENT',
    '学校 B 学生',
    '00000000-0000-4000-8000-000000000902',
    NULL,
    'S001',
    false,
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000914',
    'school_a_student',
    'STUDENT',
    '学校 A 学生',
    '00000000-0000-4000-8000-000000000901',
    NULL,
    'S001',
    false,
    now()
  );

INSERT INTO classrooms (id, name, manager_id, school_id, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000921',
  '学校 A 班级',
  '00000000-0000-4000-8000-000000000911',
  '00000000-0000-4000-8000-000000000901',
  now()
);

DO $test$
BEGIN
  BEGIN
    INSERT INTO classrooms (id, name, manager_id, school_id, updated_at)
    VALUES (
      '00000000-0000-4000-8000-000000000922',
      '跨校班级',
      '00000000-0000-4000-8000-000000000911',
      '00000000-0000-4000-8000-000000000902',
      now()
    );
    RAISE EXCEPTION 'cross-school classroom manager was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

INSERT INTO classroom_memberships (id, classroom_id, student_id)
VALUES (
  '00000000-0000-4000-8000-000000000924',
  '00000000-0000-4000-8000-000000000921',
  '00000000-0000-4000-8000-000000000914'
);

DO $test$
BEGIN
  BEGIN
    UPDATE classrooms
    SET
      manager_id = '00000000-0000-4000-8000-000000000912',
      school_id = '00000000-0000-4000-8000-000000000902'
    WHERE id = '00000000-0000-4000-8000-000000000921';
    RAISE EXCEPTION 'classroom school mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO classroom_memberships (id, classroom_id, student_id)
    VALUES (
      '00000000-0000-4000-8000-000000000923',
      '00000000-0000-4000-8000-000000000921',
      '00000000-0000-4000-8000-000000000913'
    );
    RAISE EXCEPTION 'cross-school membership was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE schools
    SET code = 'SCHZZZZZ'
    WHERE id = '00000000-0000-4000-8000-000000000901';
    RAISE EXCEPTION 'school code mutation was accepted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END
$test$;

DO $test$
BEGIN
  BEGIN
    INSERT INTO app_users (
      id, auth_subject, role, display_name, legacy_profile, updated_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000930',
      'second_admin',
      'ADMIN',
      '第二管理员',
      false,
      now()
    );
    INSERT INTO app_users (
      id, auth_subject, role, display_name, legacy_profile, updated_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000931',
      'third_admin',
      'ADMIN',
      '第三管理员',
      false,
      now()
    );
    RAISE EXCEPTION 'second admin was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$test$;

SELECT 'database invariants passed' AS result;

ROLLBACK;
