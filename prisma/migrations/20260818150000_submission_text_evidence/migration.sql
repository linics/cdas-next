-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "latest_revision_number" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_working_copies" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "base_revision_number" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "text_evidence" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submission_working_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_revisions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "base_revision_number" INTEGER NOT NULL,
    "source_working_copy_id" UUID NOT NULL,
    "source_working_version" INTEGER NOT NULL,
    "text_evidence" TEXT NOT NULL,
    "is_late" BOOLEAN NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submission_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "submissions_release_id_student_id_key" ON "submissions"("release_id", "student_id");

-- CreateIndex
CREATE INDEX "submissions_student_id_created_at_idx" ON "submissions"("student_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "submission_working_copies_submission_id_key" ON "submission_working_copies"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_revisions_source_working_copy_id_key" ON "submission_revisions"("source_working_copy_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_revisions_submission_id_revision_number_key" ON "submission_revisions"("submission_id", "revision_number");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "activity_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_working_copies" ADD CONSTRAINT "submission_working_copies_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_revisions" ADD CONSTRAINT "submission_revisions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks that Prisma cannot express in the schema.
ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_latest_revision_nonnegative" CHECK ("latest_revision_number" >= 0);

ALTER TABLE "submission_working_copies"
  ADD CONSTRAINT "submission_working_copies_base_revision_nonnegative" CHECK ("base_revision_number" >= 0),
  ADD CONSTRAINT "submission_working_copies_version_positive" CHECK ("version" > 0);

ALTER TABLE "submission_revisions"
  ADD CONSTRAINT "submission_revisions_number_positive" CHECK ("revision_number" > 0),
  ADD CONSTRAINT "submission_revisions_base_matches_number" CHECK ("base_revision_number" = "revision_number" - 1),
  ADD CONSTRAINT "submission_revisions_source_version_positive" CHECK ("source_working_version" > 0),
  ADD CONSTRAINT "submission_revisions_text_not_blank" CHECK ("text_evidence" !~ '^[[:space:]]*$');

-- A submitted revision is append-only business history. Working copies remain
-- mutable and are removed only when their exact version is submitted.
CREATE TRIGGER "submission_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "submission_revisions"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();
