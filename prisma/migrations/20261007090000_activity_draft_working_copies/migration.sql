-- CreateTable
CREATE TABLE "activity_draft_working_copies" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "draft_id" UUID,
    "base_version" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL DEFAULT '',
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activity_draft_working_copies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_draft_working_copies_draft_id_key" ON "activity_draft_working_copies"("draft_id");

-- CreateIndex
CREATE INDEX "activity_draft_working_copies_owner_id_updated_at_idx" ON "activity_draft_working_copies"("owner_id", "updated_at");

-- AddForeignKey
ALTER TABLE "activity_draft_working_copies" ADD CONSTRAINT "activity_draft_working_copies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_working_copies" ADD CONSTRAINT "activity_draft_working_copies_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "activity_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- D-093 guards: a working copy is one teacher's scratch copy of one task book.
-- A new task book's copy has no draft and no base version; a copy of an
-- existing draft starts from that draft's saved version. Content stays a JSON
-- object of bounded size; it is checked against the task-book shape in the
-- command, and against the full schema only when a version is saved.
ALTER TABLE "activity_draft_working_copies"
  ADD CONSTRAINT "activity_draft_working_copies_version_positive"
    CHECK ("version" >= 1),
  ADD CONSTRAINT "activity_draft_working_copies_base_matches_draft"
    CHECK (("draft_id" IS NULL AND "base_version" = 0) OR ("draft_id" IS NOT NULL AND "base_version" >= 1)),
  ADD CONSTRAINT "activity_draft_working_copies_title_bounds"
    CHECK (char_length("title") <= 120),
  ADD CONSTRAINT "activity_draft_working_copies_content_object"
    CHECK (jsonb_typeof("content") = 'object' AND octet_length("content"::text) <= 400000),
  ADD CONSTRAINT "activity_draft_working_copies_updated_after_create"
    CHECK ("updated_at" >= "created_at");
