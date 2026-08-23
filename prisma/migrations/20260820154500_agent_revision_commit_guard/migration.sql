-- Agent-authored draft history is only valid when the owning AgentRun reaches
-- SUCCEEDED in the same transaction. The immediate INSERT provenance trigger
-- still requires the run to be RUNNING while the revision is created; these
-- deferred checks validate the final committed state in both directions.
-- A successful run owns at most one draft result. Exact retries return the
-- existing idempotent response and therefore do not need another revision.
DROP INDEX "activity_draft_revisions_agent_run_id_idx";

CREATE UNIQUE INDEX "activity_draft_revisions_agent_run_id_key"
  ON "activity_draft_revisions" ("agent_run_id");

CREATE FUNCTION "require_agent_draft_revision_success"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_actor_id UUID;
  run_status "AgentRunStatus";
  draft_owner_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'activity_draft_revisions' THEN
    IF NEW."source" <> 'AGENT' THEN
      RETURN NULL;
    END IF;

    -- Serialize the commit-time check with every terminal AgentRun update. A
    -- concurrent FAILED/CANCELLED transition either completes first and is
    -- observed here, or waits for this transaction and then fails its own
    -- reverse-direction constraint check.
    SELECT
      agent_run."actor_id",
      agent_run."status",
      draft."owner_id"
    INTO
      run_actor_id,
      run_status,
      draft_owner_id
    FROM "agent_runs" AS agent_run
    JOIN "activity_drafts" AS draft
      ON draft."id" = NEW."draft_id"
    WHERE agent_run."id" = NEW."agent_run_id"
    FOR UPDATE OF agent_run;

    IF NOT FOUND
      OR run_actor_id IS DISTINCT FROM draft_owner_id
      OR run_status <> 'SUCCEEDED' THEN
      RAISE EXCEPTION 'agent draft revision requires a succeeded run owned by the draft teacher'
        USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'agent_runs' AND EXISTS (
    SELECT 1
    FROM "activity_draft_revisions" AS revision
    JOIN "activity_drafts" AS draft
      ON draft."id" = revision."draft_id"
    WHERE revision."agent_run_id" = NEW."id"
      AND revision."source" = 'AGENT'
      AND (
        NEW."status" <> 'SUCCEEDED'
        OR draft."owner_id" IS DISTINCT FROM NEW."actor_id"
      )
  ) THEN
    RAISE EXCEPTION 'an agent run with draft revisions must succeed for the same teacher'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "activity_draft_revisions_require_succeeded_agent_run"
  AFTER INSERT ON "activity_draft_revisions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_agent_draft_revision_success"();

CREATE CONSTRAINT TRIGGER "agent_runs_reject_unsuccessful_draft_history"
  AFTER UPDATE ON "agent_runs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_agent_draft_revision_success"();
