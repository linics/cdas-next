-- Sealed drafts and published releases are historical facts. Enforce their
-- lifecycle in PostgreSQL so neither a page nor an ORM call can reopen or
-- rewrite them.
CREATE FUNCTION "enforce_sealed_activity_draft"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'SEALED' THEN
    RAISE EXCEPTION 'sealed activity drafts cannot be changed or deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "activity_drafts_sealed_history"
  BEFORE UPDATE OR DELETE ON "activity_drafts"
  FOR EACH ROW EXECUTE FUNCTION "enforce_sealed_activity_draft"();

CREATE FUNCTION "enforce_activity_release_lifecycle"()
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

CREATE TRIGGER "activity_releases_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "activity_releases"
  FOR EACH ROW EXECUTE FUNCTION "enforce_activity_release_lifecycle"();

-- The composite relation proves that a snapshot and its release name the same
-- source draft, rather than merely proving both rows exist independently.
CREATE UNIQUE INDEX "activity_releases_id_source_draft_id_key"
  ON "activity_releases" ("id", "source_draft_id");

CREATE UNIQUE INDEX "activity_release_snapshots_release_id_source_draft_id_key"
  ON "activity_release_snapshots" ("release_id", "source_draft_id");

ALTER TABLE "activity_release_snapshots"
  DROP CONSTRAINT "activity_release_snapshots_release_id_fkey";

ALTER TABLE "activity_release_snapshots"
  ADD CONSTRAINT "activity_release_snapshots_release_id_source_draft_id_fkey"
  FOREIGN KEY ("release_id", "source_draft_id")
  REFERENCES "activity_releases" ("id", "source_draft_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "require_activity_release_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "activity_release_snapshots" AS snapshot
    WHERE snapshot."release_id" = NEW."id"
      AND snapshot."source_draft_id" = NEW."source_draft_id"
  ) THEN
    RAISE EXCEPTION 'activity release % requires one matching snapshot', NEW."id"
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "activity_releases_require_snapshot"
  AFTER INSERT ON "activity_releases"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_activity_release_snapshot"();

-- Action parameters become immutable as soon as the intent is prepared. Only
-- the explicit lifecycle fields may move forward through the state machine.
ALTER TABLE "action_intents"
  DROP CONSTRAINT "action_intents_status_timestamps",
  ADD CONSTRAINT "action_intents_expected_version_positive" CHECK (
    "expected_version" IS NULL OR "expected_version" > 0
  ),
  ADD CONSTRAINT "action_intents_names_not_blank" CHECK (
    btrim("action_name") <> '' AND btrim("target_type") <> ''
  ),
  ADD CONSTRAINT "action_intents_status_timestamps" CHECK (
    (
      "status" = 'PREPARED'
      AND "decided_by_id" IS NULL
      AND "decided_at" IS NULL
      AND "executed_at" IS NULL
    )
    OR (
      "status" IN ('CONFIRMED', 'REJECTED')
      AND "decided_by_id" = "actor_id"
      AND "decided_at" >= "created_at"
      AND "decided_at" < "expires_at"
      AND "executed_at" IS NULL
    )
    OR (
      "status" = 'EXECUTED'
      AND "decided_by_id" = "actor_id"
      AND "decided_at" >= "created_at"
      AND "decided_at" <= "executed_at"
      AND "executed_at" < "expires_at"
    )
    OR (
      "status" = 'EXPIRED'
      AND "executed_at" IS NULL
      AND (
        ("decided_by_id" IS NULL AND "decided_at" IS NULL)
        OR (
          "decided_by_id" = "actor_id"
          AND "decided_at" >= "created_at"
          AND "decided_at" < "expires_at"
        )
      )
    )
  );

CREATE FUNCTION "enforce_action_intent_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'action intents cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PREPARED'
      OR NEW."decided_by_id" IS NOT NULL
      OR NEW."decided_at" IS NOT NULL
      OR NEW."executed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'action intents must start prepared'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."actor_id" IS DISTINCT FROM OLD."actor_id"
    OR NEW."agent_run_id" IS DISTINCT FROM OLD."agent_run_id"
    OR NEW."action_name" IS DISTINCT FROM OLD."action_name"
    OR NEW."payload" IS DISTINCT FROM OLD."payload"
    OR NEW."payload_hash" IS DISTINCT FROM OLD."payload_hash"
    OR NEW."target_type" IS DISTINCT FROM OLD."target_type"
    OR NEW."target_id" IS DISTINCT FROM OLD."target_id"
    OR NEW."expected_version" IS DISTINCT FROM OLD."expected_version"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'prepared action intent parameters are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF NEW."decided_by_id" IS DISTINCT FROM OLD."decided_by_id"
      OR NEW."decided_at" IS DISTINCT FROM OLD."decided_at"
      OR NEW."executed_at" IS DISTINCT FROM OLD."executed_at" THEN
      RAISE EXCEPTION 'action intent lifecycle fields cannot change in place'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PREPARED' AND NEW."status" IN ('CONFIRMED', 'REJECTED') THEN
    IF NEW."decided_by_id" IS DISTINCT FROM OLD."actor_id"
      OR NEW."decided_at" IS NULL
      OR NEW."executed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'confirming or rejecting requires the owning human decision'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" = 'PREPARED' AND NEW."status" = 'EXPIRED' THEN
    IF NEW."decided_by_id" IS NOT NULL
      OR NEW."decided_at" IS NOT NULL
      OR NEW."executed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'an unconfirmed expired intent cannot gain decision history'
        USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" = 'CONFIRMED' AND NEW."status" IN ('EXECUTED', 'EXPIRED') THEN
    IF NEW."decided_by_id" IS DISTINCT FROM OLD."decided_by_id"
      OR NEW."decided_at" IS DISTINCT FROM OLD."decided_at"
      OR (
        NEW."status" = 'EXECUTED'
        AND NEW."executed_at" IS NULL
      )
      OR (
        NEW."status" = 'EXPIRED'
        AND NEW."executed_at" IS NOT NULL
      ) THEN
      RAISE EXCEPTION 'confirmed intent history must be preserved'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid action intent status transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "action_intents_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "action_intents"
  FOR EACH ROW EXECUTE FUNCTION "enforce_action_intent_lifecycle"();

ALTER TABLE "action_audits"
  DROP CONSTRAINT "action_audits_action_intent_id_fkey";

ALTER TABLE "action_audits"
  ADD CONSTRAINT "action_audits_action_intent_id_fkey"
  FOREIGN KEY ("action_intent_id") REFERENCES "action_intents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
