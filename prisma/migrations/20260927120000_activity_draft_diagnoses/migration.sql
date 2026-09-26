-- CreateTable
CREATE TABLE "activity_draft_diagnoses" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "agent_run_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_draft_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_draft_diagnoses_agent_run_id_key" ON "activity_draft_diagnoses"("agent_run_id");

-- CreateIndex
CREATE INDEX "activity_draft_diagnoses_draft_id_created_at_idx" ON "activity_draft_diagnoses"("draft_id", "created_at");

-- AddForeignKey
ALTER TABLE "activity_draft_diagnoses" ADD CONSTRAINT "activity_draft_diagnoses_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "activity_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_diagnoses" ADD CONSTRAINT "activity_draft_diagnoses_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "activity_draft_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_diagnoses" ADD CONSTRAINT "activity_draft_diagnoses_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_diagnoses" ADD CONSTRAINT "activity_draft_diagnoses_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D-068 guards: diagnoses are append-only history bound to the revision
-- they read, requested by the draft owner, with the run that produced them.
ALTER TABLE "activity_draft_diagnoses"
  ADD CONSTRAINT "activity_draft_diagnoses_summary_bounds"
    CHECK (btrim("summary") <> '' AND char_length("summary") <= 400),
  ADD CONSTRAINT "activity_draft_diagnoses_findings_array"
    CHECK (jsonb_typeof("findings") = 'array' AND jsonb_array_length("findings") <= 8);

CREATE TRIGGER "activity_draft_diagnoses_immutable"
  BEFORE UPDATE OR DELETE ON "activity_draft_diagnoses"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

CREATE FUNCTION "enforce_activity_draft_diagnosis"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "activity_draft_revisions" r
    JOIN "activity_drafts" d ON d."id" = r."draft_id"
    JOIN "agent_runs" run ON run."id" = NEW."agent_run_id"
    WHERE r."id" = NEW."revision_id"
      AND r."draft_id" = NEW."draft_id"
      AND d."owner_id" = NEW."requested_by_id"
      AND run."actor_id" = NEW."requested_by_id"
      AND run."status" IN ('RUNNING', 'SUCCEEDED')
  ) THEN
    RAISE EXCEPTION 'diagnosis must belong to an owned revision and the owner''s run'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "activity_draft_diagnoses_provenance_guard"
  BEFORE INSERT ON "activity_draft_diagnoses"
  FOR EACH ROW EXECUTE FUNCTION "enforce_activity_draft_diagnosis"();
