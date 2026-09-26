-- CreateEnum
CREATE TYPE "SourceReferenceOrigin" AS ENUM ('AGENT_PROPOSAL', 'TEACHER_SELECTION');

-- CreateTable
CREATE TABLE "activity_draft_source_references" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "origin" "SourceReferenceOrigin" NOT NULL,
    "agent_run_id" UUID,
    "adopted_by_id" UUID NOT NULL,
    "source_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "source_hash" CHAR(64) NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "citation_label" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_draft_source_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_draft_source_withdrawals" (
    "reference_id" UUID NOT NULL,
    "withdrawn_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_draft_source_withdrawals_pkey" PRIMARY KEY ("reference_id")
);

-- CreateIndex
CREATE INDEX "activity_draft_source_references_draft_id_created_at_idx" ON "activity_draft_source_references"("draft_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_draft_source_references_revision_id_section_id_key" ON "activity_draft_source_references"("revision_id", "section_id");

-- AddForeignKey
ALTER TABLE "activity_draft_source_references" ADD CONSTRAINT "activity_draft_source_references_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "activity_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_source_references" ADD CONSTRAINT "activity_draft_source_references_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "activity_draft_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_source_references" ADD CONSTRAINT "activity_draft_source_references_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_source_references" ADD CONSTRAINT "activity_draft_source_references_adopted_by_id_fkey" FOREIGN KEY ("adopted_by_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_source_withdrawals" ADD CONSTRAINT "activity_draft_source_withdrawals_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "activity_draft_source_references"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_source_withdrawals" ADD CONSTRAINT "activity_draft_source_withdrawals_withdrawn_by_id_fkey" FOREIGN KEY ("withdrawn_by_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D-067 guards. Both tables are append-only history.
ALTER TABLE "activity_draft_source_references"
  ADD CONSTRAINT "activity_draft_source_references_hash_format"
    CHECK ("source_hash" ~ '^[0-9a-f]{64}$' AND "content_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "activity_draft_source_references_text_bounds"
    CHECK (
      btrim("rationale") <> '' AND char_length("rationale") <= 600
      AND btrim("citation_label") <> '' AND char_length("citation_label") <= 700
      AND "source_id" ~ '^[a-z0-9-]{3,80}$' AND "section_id" ~ '^[a-z0-9-]{8,120}$'
    ),
  ADD CONSTRAINT "activity_draft_source_references_origin_run"
    CHECK (("origin" = 'AGENT_PROPOSAL') = ("agent_run_id" IS NOT NULL));

CREATE TRIGGER "activity_draft_source_references_immutable"
  BEFORE UPDATE OR DELETE ON "activity_draft_source_references"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

CREATE TRIGGER "activity_draft_source_withdrawals_immutable"
  BEFORE UPDATE OR DELETE ON "activity_draft_source_withdrawals"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

-- A reference belongs to a revision of its own draft, is adopted by the draft
-- owner, and an AI reference is bound to the AgentRun that produced exactly
-- that AGENT revision.
CREATE FUNCTION "enforce_activity_draft_source_reference"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_draft_id UUID;
  revision_source "DraftRevisionSource";
  revision_run_id UUID;
  draft_owner_id UUID;
BEGIN
  SELECT r."draft_id", r."source", r."agent_run_id", d."owner_id"
  INTO revision_draft_id, revision_source, revision_run_id, draft_owner_id
  FROM "activity_draft_revisions" r
  JOIN "activity_drafts" d ON d."id" = r."draft_id"
  WHERE r."id" = NEW."revision_id";

  IF revision_draft_id IS DISTINCT FROM NEW."draft_id"
    OR draft_owner_id IS DISTINCT FROM NEW."adopted_by_id"
    OR (NEW."origin" = 'AGENT_PROPOSAL' AND (
      revision_source <> 'AGENT' OR revision_run_id IS DISTINCT FROM NEW."agent_run_id"
    )) THEN
    RAISE EXCEPTION 'source reference must belong to an owned revision and its own run'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "activity_draft_source_references_provenance_guard"
  BEFORE INSERT ON "activity_draft_source_references"
  FOR EACH ROW EXECUTE FUNCTION "enforce_activity_draft_source_reference"();

CREATE FUNCTION "enforce_activity_draft_source_withdrawal"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "activity_draft_source_references" reference
    JOIN "activity_drafts" d ON d."id" = reference."draft_id"
    WHERE reference."id" = NEW."reference_id"
      AND d."owner_id" = NEW."withdrawn_by_id"
      AND reference."created_at" <= NEW."created_at"
  ) THEN
    RAISE EXCEPTION 'only the draft owner may withdraw a source reference'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "activity_draft_source_withdrawals_owner_guard"
  BEFORE INSERT ON "activity_draft_source_withdrawals"
  FOR EACH ROW EXECUTE FUNCTION "enforce_activity_draft_source_withdrawal"();
