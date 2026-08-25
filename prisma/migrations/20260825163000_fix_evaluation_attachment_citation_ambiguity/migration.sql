-- Rename PL/pgSQL variable so attachment citation checks are not ambiguous with link.attachment_id.
CREATE OR REPLACE FUNCTION "assert_teacher_evaluation_outcomes"(
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
