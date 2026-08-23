-- AgentRun is durable provenance. Deleting it must not erase the source from
-- immutable revisions, intents, or audits.
ALTER TABLE "activity_draft_revisions"
  DROP CONSTRAINT "activity_draft_revisions_agent_run_id_fkey",
  ADD CONSTRAINT "activity_draft_revisions_agent_run_id_fkey"
    FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "action_intents"
  DROP CONSTRAINT "action_intents_agent_run_id_fkey",
  ADD CONSTRAINT "action_intents_agent_run_id_fkey"
    FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "action_audits"
  DROP CONSTRAINT "action_audits_agent_run_id_fkey",
  ADD CONSTRAINT "action_audits_agent_run_id_fkey"
    FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_terminal_shape"
  CHECK (
    (
      "status" = 'RUNNING'
      AND "completed_at" IS NULL
      AND "failure_code" IS NULL
    )
    OR (
      "status" = 'SUCCEEDED'
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "started_at"
      AND "failure_code" IS NULL
    )
    OR (
      "status" IN ('FAILED', 'CANCELLED')
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "started_at"
      AND "failure_code" ~ '^[A-Z0-9_]{1,120}$'
    )
  );

CREATE FUNCTION "enforce_agent_run_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agent run provenance cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RUNNING'
      OR NEW."completed_at" IS NOT NULL
      OR NEW."failure_code" IS NOT NULL THEN
      RAISE EXCEPTION 'agent run must start in RUNNING state'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."actor_id" IS DISTINCT FROM OLD."actor_id"
    OR NEW."model" IS DISTINCT FROM OLD."model"
    OR NEW."started_at" IS DISTINCT FROM OLD."started_at" THEN
    RAISE EXCEPTION 'agent run identity and model are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."status" <> 'RUNNING'
    OR NEW."status" NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'invalid agent run status transition'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "agent_runs_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "agent_runs"
  FOR EACH ROW EXECUTE FUNCTION "enforce_agent_run_lifecycle"();

-- A new Agent revision must be created while its owned run is still live. The
-- same transaction may then atomically advance that run to SUCCEEDED.
CREATE OR REPLACE FUNCTION "enforce_activity_draft_revision_provenance"()
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
      AND agent_run."status" = 'RUNNING'
  ) THEN
    RAISE EXCEPTION 'agent revision requires a live run owned by the draft teacher'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
