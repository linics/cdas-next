-- Closing a release is a confirmed high-impact action. Preserve the exact
-- ActionIntent that caused the ACTIVE -> CLOSED transition without turning the
-- current classroom manager into a permanent historical invariant.
ALTER TABLE "activity_releases"
  ADD COLUMN "close_action_intent_id" UUID;

CREATE FUNCTION "cdas_close_release_payload_canonical"(payload_value JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT
    '{"expectedStatus":' || to_json(payload_value ->> 'expectedStatus')::TEXT
    || ',"releaseId":' || to_json(payload_value ->> 'releaseId')::TEXT
    || ',"schemaVersion":' || (payload_value ->> 'schemaVersion')::INTEGER::TEXT
    || '}';
$$;

-- Recover only an unambiguous, already-valid successful close audit. A closed
-- row without exactly one such audit is dirty history and aborts this migration.
WITH "valid_close_candidates" AS (
  SELECT
    release."id" AS "release_id",
    (array_agg(audit."action_intent_id" ORDER BY audit."id"))[1] AS "intent_id",
    count(*) AS "candidate_count"
  FROM "activity_releases" AS release
  JOIN "action_audits" AS audit
    ON audit."outcome" = 'SUCCEEDED'
    AND audit."action_name" = 'close_activity_release'
    AND audit."target_type" = 'ActivityRelease'
    AND audit."target_id" = release."id"
    AND audit."result_resource_id" = release."id"
    AND audit."actor_id" = release."publisher_id"
    AND audit."action_intent_id" IS NOT NULL
  JOIN "action_intents" AS intent
    ON intent."id" = audit."action_intent_id"
    AND intent."status" = 'EXECUTED'
    AND intent."action_name" = 'close_activity_release'
    AND intent."target_type" = 'ActivityRelease'
    AND intent."target_id" = release."id"
    AND intent."actor_id" = release."publisher_id"
    AND intent."decided_by_id" = release."publisher_id"
    AND intent."agent_run_id" IS NULL
    AND intent."expected_version" IS NULL
    AND intent."executed_at" = release."closed_at"
    AND intent."payload" = jsonb_build_object(
      'schemaVersion', 1,
      'releaseId', release."id"::TEXT,
      'expectedStatus', 'ACTIVE'
    )
    AND intent."payload_hash" = encode(
      sha256(convert_to("cdas_close_release_payload_canonical"(intent."payload"), 'UTF8')),
      'hex'
    )
  WHERE release."status" IN ('CLOSED', 'ARCHIVED')
  GROUP BY release."id"
)
UPDATE "activity_releases" AS release
SET "close_action_intent_id" = candidate."intent_id"
FROM "valid_close_candidates" AS candidate
WHERE candidate."release_id" = release."id"
  AND candidate."candidate_count" = 1;

DO $$
DECLARE
  invalid_release_id UUID;
BEGIN
  SELECT release."id"
  INTO invalid_release_id
  FROM "activity_releases" AS release
  WHERE release."status" IN ('CLOSED', 'ARCHIVED')
    AND release."close_action_intent_id" IS NULL
  ORDER BY release."id"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'cannot bind closed activity release % to exactly one valid successful close audit', invalid_release_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "activity_releases_close_action_intent_id_key"
  ON "activity_releases" ("close_action_intent_id");

ALTER TABLE "activity_releases"
  ADD CONSTRAINT "activity_releases_close_action_intent_id_fkey"
    FOREIGN KEY ("close_action_intent_id") REFERENCES "action_intents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  DROP CONSTRAINT "activity_releases_lifecycle",
  ADD CONSTRAINT "activity_releases_lifecycle" CHECK (
    (
      "status" = 'ACTIVE'
      AND "closed_at" IS NULL
      AND "archived_at" IS NULL
      AND "close_action_intent_id" IS NULL
    )
    OR (
      "status" = 'CLOSED'
      AND "closed_at" IS NOT NULL
      AND "archived_at" IS NULL
      AND "close_action_intent_id" IS NOT NULL
    )
    OR (
      "status" = 'ARCHIVED'
      AND "closed_at" IS NOT NULL
      AND "archived_at" IS NOT NULL
      AND "archived_at" >= "closed_at"
      AND "close_action_intent_id" IS NOT NULL
    )
  );

CREATE FUNCTION "assert_close_release_integrity"(target_release_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  release_row "activity_releases"%ROWTYPE;
  intent_row "action_intents"%ROWTYPE;
  expected_payload JSONB;
  expected_payload_hash TEXT;
BEGIN
  SELECT *
  INTO release_row
  FROM "activity_releases" AS release
  WHERE release."id" = target_release_id;

  IF NOT FOUND
    OR release_row."status" NOT IN ('CLOSED', 'ARCHIVED')
    OR release_row."closed_at" IS NULL
    OR release_row."close_action_intent_id" IS NULL THEN
    RAISE EXCEPTION 'activity release % is not a properly closed release', target_release_id
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO intent_row
  FROM "action_intents" AS intent
  WHERE intent."id" = release_row."close_action_intent_id";

  IF NOT FOUND
    OR intent_row."status" <> 'EXECUTED'
    OR intent_row."action_name" <> 'close_activity_release'
    OR intent_row."target_type" <> 'ActivityRelease'
    OR intent_row."target_id" IS DISTINCT FROM release_row."id"
    OR intent_row."actor_id" IS DISTINCT FROM release_row."publisher_id"
    OR intent_row."decided_by_id" IS DISTINCT FROM release_row."publisher_id"
    OR intent_row."agent_run_id" IS NOT NULL
    OR intent_row."expected_version" IS NOT NULL
    OR intent_row."executed_at" IS DISTINCT FROM release_row."closed_at" THEN
    RAISE EXCEPTION 'activity release % is not backed by its executed close intent', target_release_id
      USING ERRCODE = '23514';
  END IF;

  expected_payload := jsonb_build_object(
    'schemaVersion', 1,
    'releaseId', release_row."id"::TEXT,
    'expectedStatus', 'ACTIVE'
  );

  IF intent_row."payload" IS DISTINCT FROM expected_payload THEN
    RAISE EXCEPTION 'activity release % close payload is invalid', target_release_id
      USING ERRCODE = '23514';
  END IF;

  expected_payload_hash := encode(
    sha256(convert_to("cdas_close_release_payload_canonical"(intent_row."payload"), 'UTF8')),
    'hex'
  );

  IF intent_row."payload_hash" IS DISTINCT FROM expected_payload_hash THEN
    RAISE EXCEPTION 'activity release % close payload hash is invalid', target_release_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Validate recovered history in both directions before installing the
-- forward-only constraint triggers.
DO $$
DECLARE
  release_record RECORD;
  orphan_intent_id UUID;
BEGIN
  FOR release_record IN
    SELECT release."id"
    FROM "activity_releases" AS release
    WHERE release."status" IN ('CLOSED', 'ARCHIVED')
    ORDER BY release."id"
  LOOP
    PERFORM "assert_close_release_integrity"(release_record."id");
  END LOOP;

  SELECT intent."id"
  INTO orphan_intent_id
  FROM "action_intents" AS intent
  LEFT JOIN "activity_releases" AS release
    ON release."close_action_intent_id" = intent."id"
  WHERE intent."action_name" = 'close_activity_release'
    AND intent."status" = 'EXECUTED'
    AND release."id" IS NULL
  ORDER BY intent."id"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'executed close intent % has no closed activity release', orphan_intent_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

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
    OR NEW."published_at" IS DISTINCT FROM OLD."published_at"
    OR NEW."due_at" IS DISTINCT FROM OLD."due_at" THEN
    RAISE EXCEPTION 'published release identity and schedule are immutable'
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

CREATE FUNCTION "enforce_close_release_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  release_uuid UUID;
BEGIN
  IF TG_TABLE_NAME = 'activity_releases' THEN
    release_uuid := NEW."id";
  ELSE
    SELECT release."id"
    INTO release_uuid
    FROM "activity_releases" AS release
    WHERE release."close_action_intent_id" = NEW."id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'executed close intent % requires one closed activity release', NEW."id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  PERFORM "assert_close_release_integrity"(release_uuid);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "activity_releases_close_integrity"
  AFTER UPDATE ON "activity_releases"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD."status" = 'ACTIVE' AND NEW."status" = 'CLOSED')
  EXECUTE FUNCTION "enforce_close_release_integrity"();

CREATE CONSTRAINT TRIGGER "close_action_intents_require_release"
  AFTER UPDATE ON "action_intents"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW."status" = 'EXECUTED' AND NEW."action_name" = 'close_activity_release')
  EXECUTE FUNCTION "enforce_close_release_integrity"();
