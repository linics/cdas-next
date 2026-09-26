CREATE TABLE "activity_draft_origins" (
  "draft_id" UUID NOT NULL,
  "source_revision_id" UUID,
  "source_release_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_draft_origins_pkey" PRIMARY KEY ("draft_id"),
  CONSTRAINT "activity_draft_origins_exact_source" CHECK (
    num_nonnulls("source_revision_id", "source_release_id") = 1
  ),
  CONSTRAINT "activity_draft_origins_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "activity_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "activity_draft_origins_source_revision_id_fkey" FOREIGN KEY ("source_revision_id") REFERENCES "activity_draft_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "activity_draft_origins_source_release_id_fkey" FOREIGN KEY ("source_release_id") REFERENCES "activity_release_snapshots"("release_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TRIGGER "activity_draft_origins_immutable"
  BEFORE UPDATE OR DELETE ON "activity_draft_origins"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

-- Origin must describe the new draft's initial content, not a later revision.
-- Titles are deliberately excluded: teachers name the copy at confirmation.
CREATE FUNCTION "enforce_activity_draft_origin"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_draft "activity_drafts"%ROWTYPE;
  source_content JSONB;
  source_owner UUID;
BEGIN
  SELECT * INTO target_draft FROM "activity_drafts" WHERE "id" = NEW."draft_id";
  IF NEW."source_revision_id" IS NOT NULL THEN
    SELECT r."task_book", d."owner_id" INTO source_content, source_owner
    FROM "activity_draft_revisions" r JOIN "activity_drafts" d ON d."id" = r."draft_id"
    WHERE r."id" = NEW."source_revision_id" AND d."id" <> NEW."draft_id";
  ELSE
    SELECT s."content", r."publisher_id" INTO source_content, source_owner
    FROM "activity_release_snapshots" s JOIN "activity_releases" r ON r."id" = s."release_id"
    WHERE s."release_id" = NEW."source_release_id";
  END IF;
  IF target_draft."version" <> 1 OR target_draft."status" <> 'EDITING'
    OR source_owner IS DISTINCT FROM target_draft."owner_id"
    OR source_content IS NULL OR source_content->>'schemaVersion' <> '3'
    OR target_draft."schema_version" <> 3
    OR (source_content - 'title') IS DISTINCT FROM (target_draft."task_book" - 'title')
    OR NEW."created_at" IS DISTINCT FROM target_draft."created_at" THEN
    RAISE EXCEPTION 'draft origin must match the owned v3 source and initial copy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "activity_draft_origins_provenance_guard"
  BEFORE INSERT ON "activity_draft_origins"
  FOR EACH ROW EXECUTE FUNCTION "enforce_activity_draft_origin"();
