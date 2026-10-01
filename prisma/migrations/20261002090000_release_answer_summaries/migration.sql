-- CreateTable
CREATE TABLE "release_answer_summaries" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "phase_index" INTEGER NOT NULL,
    "agent_run_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "themes" JSONB NOT NULL,
    "basis_revision_ids" UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_answer_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "release_answer_summaries_agent_run_id_key" ON "release_answer_summaries"("agent_run_id");

-- CreateIndex
CREATE INDEX "release_answer_summaries_release_id_phase_index_created_at_idx" ON "release_answer_summaries"("release_id", "phase_index", "created_at");

-- AddForeignKey
ALTER TABLE "release_answer_summaries" ADD CONSTRAINT "release_answer_summaries_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "activity_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_answer_summaries" ADD CONSTRAINT "release_answer_summaries_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_answer_summaries" ADD CONSTRAINT "release_answer_summaries_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D-086 guards: a summary is append-only history. It belongs to a release the
-- requester published and still manages, is produced by the requester's own
-- run, and names the formal revisions it read.
ALTER TABLE "release_answer_summaries"
  ALTER COLUMN "basis_revision_ids" SET NOT NULL,
  ADD CONSTRAINT "release_answer_summaries_summary_bounds"
    CHECK (btrim("summary") <> '' AND char_length("summary") <= 400),
  ADD CONSTRAINT "release_answer_summaries_themes_array"
    CHECK (jsonb_typeof("themes") = 'array' AND jsonb_array_length("themes") <= 6),
  ADD CONSTRAINT "release_answer_summaries_phase_index_bounds"
    CHECK ("phase_index" >= 0),
  ADD CONSTRAINT "release_answer_summaries_basis_bounds"
    CHECK (cardinality("basis_revision_ids") BETWEEN 3 AND 60);

CREATE TRIGGER "release_answer_summaries_immutable"
  BEFORE UPDATE OR DELETE ON "release_answer_summaries"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

CREATE FUNCTION "enforce_release_answer_summary"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "activity_releases" r
    JOIN "classrooms" c ON c."id" = r."classroom_id"
    JOIN "agent_runs" run ON run."id" = NEW."agent_run_id"
    WHERE r."id" = NEW."release_id"
      AND r."publisher_id" = NEW."requested_by_id"
      AND c."manager_id" = NEW."requested_by_id"
      AND run."actor_id" = NEW."requested_by_id"
      AND run."status" IN ('RUNNING', 'SUCCEEDED')
  ) THEN
    RAISE EXCEPTION 'answer summary must belong to a managed release and the requester''s run'
      USING ERRCODE = '23514';
  END IF;
  -- Every revision it claims to have read is a formal revision of this
  -- release's submissions in this phase.
  IF EXISTS (
    SELECT 1
    FROM unnest(NEW."basis_revision_ids") AS basis(revision_id)
    LEFT JOIN "submission_revisions" sr ON sr."id" = basis.revision_id
    LEFT JOIN "submissions" s ON s."id" = sr."submission_id"
    WHERE s."id" IS NULL
      OR s."release_id" <> NEW."release_id"
      OR s."phase_index" <> NEW."phase_index"
  ) THEN
    RAISE EXCEPTION 'answer summary basis must be revisions of this release and phase'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "release_answer_summaries_provenance_guard"
  BEFORE INSERT ON "release_answer_summaries"
  FOR EACH ROW EXECUTE FUNCTION "enforce_release_answer_summary"();
