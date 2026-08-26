-- Submission attachments are private assets owned by one student submission.
-- Upload and malware scanning happen outside database transactions; only READY
-- assets may be copied from a working copy into immutable formal history.
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'PDF', 'WORD');

CREATE TYPE "AttachmentStatus" AS ENUM (
  'UPLOAD_PENDING',
  'SCAN_PENDING',
  'READY',
  'REJECTED'
);

CREATE TABLE "submission_attachments" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "kind" "AttachmentKind" NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "media_type" VARCHAR(127) NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "storage_key" VARCHAR(512) NOT NULL,
  "status" "AttachmentStatus" NOT NULL DEFAULT 'UPLOAD_PENDING',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploaded_at" TIMESTAMPTZ(3),
  "scanned_at" TIMESTAMPTZ(3),

  CONSTRAINT "submission_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "submission_working_copy_attachments" (
  "working_copy_id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "submission_working_copy_attachments_pkey"
    PRIMARY KEY ("working_copy_id", "attachment_id")
);

CREATE TABLE "submission_revision_attachments" (
  "submission_revision_id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "submission_revision_attachments_pkey"
    PRIMARY KEY ("submission_revision_id", "attachment_id")
);

CREATE UNIQUE INDEX "submission_attachments_storage_key_key"
  ON "submission_attachments"("storage_key");
CREATE INDEX "submission_attachments_submission_id_status_created_at_idx"
  ON "submission_attachments"("submission_id", "status", "created_at");
CREATE INDEX "submission_attachments_student_id_created_at_idx"
  ON "submission_attachments"("student_id", "created_at");

CREATE UNIQUE INDEX "submission_working_copy_attachments_position_key"
  ON "submission_working_copy_attachments"("working_copy_id", "position");
CREATE INDEX "submission_working_copy_attachments_attachment_id_idx"
  ON "submission_working_copy_attachments"("attachment_id");

CREATE UNIQUE INDEX "submission_revision_attachments_position_key"
  ON "submission_revision_attachments"("submission_revision_id", "position");
CREATE INDEX "submission_revision_attachments_attachment_id_idx"
  ON "submission_revision_attachments"("attachment_id");

ALTER TABLE "submission_attachments"
  ADD CONSTRAINT "submission_attachments_submission_id_fkey"
    FOREIGN KEY ("submission_id") REFERENCES "submissions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "submission_attachments_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "app_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "submission_attachments_contract" CHECK (
    "byte_size" BETWEEN 1 AND 20971520
    AND btrim("original_filename") <> ''
    AND "original_filename" NOT IN ('.', '..')
    AND strpos("original_filename", '/') = 0
    AND strpos("original_filename", E'\\') = 0
    AND "original_filename" !~ '[[:cntrl:]]'
    AND btrim("storage_key") <> ''
    AND (
      ("kind" = 'IMAGE' AND "media_type" IN ('image/jpeg', 'image/png', 'image/webp'))
      OR ("kind" = 'PDF' AND "media_type" = 'application/pdf')
      OR (
        "kind" = 'WORD'
        AND "media_type" IN (
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
      )
    )
    AND (
      ("status" = 'UPLOAD_PENDING' AND "uploaded_at" IS NULL AND "scanned_at" IS NULL)
      OR (
        "status" = 'SCAN_PENDING'
        AND "uploaded_at" IS NOT NULL
        AND "scanned_at" IS NULL
      )
      OR (
        "status" IN ('READY', 'REJECTED')
        AND "uploaded_at" IS NOT NULL
        AND "scanned_at" IS NOT NULL
      )
    )
    AND ("uploaded_at" IS NULL OR "uploaded_at" >= "created_at")
    AND ("scanned_at" IS NULL OR "scanned_at" >= "uploaded_at")
  );

ALTER TABLE "submission_working_copy_attachments"
  ADD CONSTRAINT "submission_working_copy_attachments_working_copy_id_fkey"
    FOREIGN KEY ("working_copy_id") REFERENCES "submission_working_copies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "submission_working_copy_attachments_attachment_id_fkey"
    FOREIGN KEY ("attachment_id") REFERENCES "submission_attachments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "submission_working_copy_attachments_position" CHECK (
    "position" BETWEEN 0 AND 4
  );

ALTER TABLE "submission_revision_attachments"
  ADD CONSTRAINT "submission_revision_attachments_submission_revision_id_fkey"
    FOREIGN KEY ("submission_revision_id") REFERENCES "submission_revisions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "submission_revision_attachments_attachment_id_fkey"
    FOREIGN KEY ("attachment_id") REFERENCES "submission_attachments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "submission_revision_attachments_position" CHECK (
    "position" BETWEEN 0 AND 4
  );

CREATE FUNCTION "enforce_submission_attachment_lifecycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "submissions" AS submission
      JOIN "app_users" AS student
        ON student."id" = submission."student_id"
      WHERE submission."id" = NEW."submission_id"
        AND submission."student_id" = NEW."student_id"
        AND student."role" = 'STUDENT'
    ) THEN
      RAISE EXCEPTION 'attachment owner must match its student submission'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."submission_id" IS DISTINCT FROM OLD."submission_id"
    OR NEW."student_id" IS DISTINCT FROM OLD."student_id"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."original_filename" IS DISTINCT FROM OLD."original_filename"
    OR NEW."media_type" IS DISTINCT FROM OLD."media_type"
    OR NEW."byte_size" IS DISTINCT FROM OLD."byte_size"
    OR NEW."storage_key" IS DISTINCT FROM OLD."storage_key"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'attachment identity and declared object metadata are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF NEW."uploaded_at" IS DISTINCT FROM OLD."uploaded_at"
      OR NEW."scanned_at" IS DISTINCT FROM OLD."scanned_at" THEN
      RAISE EXCEPTION 'attachment timestamps may only advance with status'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'UPLOAD_PENDING' AND NEW."status" = 'SCAN_PENDING')
    OR (
      OLD."status" = 'SCAN_PENDING'
      AND NEW."status" IN ('READY', 'REJECTED')
    )
  ) THEN
    RAISE EXCEPTION 'invalid attachment lifecycle transition'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."uploaded_at" IS NOT NULL
    AND NEW."uploaded_at" IS DISTINCT FROM OLD."uploaded_at" THEN
    RAISE EXCEPTION 'attachment upload time is immutable once recorded'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."scanned_at" IS NOT NULL
    AND NEW."scanned_at" IS DISTINCT FROM OLD."scanned_at" THEN
    RAISE EXCEPTION 'attachment scan time is immutable once recorded'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "submission_attachments_lifecycle_guard"
  BEFORE INSERT OR UPDATE ON "submission_attachments"
  FOR EACH ROW EXECUTE FUNCTION "enforce_submission_attachment_lifecycle"();

CREATE FUNCTION "enforce_submission_working_copy_attachment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM "submission_revisions" AS revision
      WHERE revision."source_working_copy_id" = OLD."working_copy_id"
    ) AND NOT EXISTS (
      SELECT 1
      FROM "submission_revisions" AS revision
      JOIN "submission_revision_attachments" AS revision_attachment
        ON revision_attachment."submission_revision_id" = revision."id"
      WHERE revision."source_working_copy_id" = OLD."working_copy_id"
        AND revision_attachment."attachment_id" = OLD."attachment_id"
        AND revision_attachment."position" = OLD."position"
    ) THEN
      RAISE EXCEPTION 'a consumed working-copy attachment must be copied into its formal revision'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW."working_copy_id" IS DISTINCT FROM OLD."working_copy_id"
      OR NEW."attachment_id" IS DISTINCT FROM OLD."attachment_id"
      OR NEW."added_at" IS DISTINCT FROM OLD."added_at"
    ) THEN
    RAISE EXCEPTION 'working-copy attachment identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "submission_working_copies" AS working_copy
    JOIN "submission_attachments" AS attachment
      ON attachment."submission_id" = working_copy."submission_id"
    WHERE working_copy."id" = NEW."working_copy_id"
      AND attachment."id" = NEW."attachment_id"
  ) THEN
    RAISE EXCEPTION 'working-copy attachment must belong to the same submission'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "submission_working_copy_attachments_ownership_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "submission_working_copy_attachments"
  FOR EACH ROW EXECUTE FUNCTION "enforce_submission_working_copy_attachment"();

CREATE FUNCTION "enforce_submission_revision_attachment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "submission_revisions" AS revision
    JOIN "submission_attachments" AS attachment
      ON attachment."submission_id" = revision."submission_id"
    JOIN "submission_working_copy_attachments" AS working_attachment
      ON working_attachment."working_copy_id" = revision."source_working_copy_id"
      AND working_attachment."attachment_id" = attachment."id"
      AND working_attachment."position" = NEW."position"
    WHERE revision."id" = NEW."submission_revision_id"
      AND attachment."id" = NEW."attachment_id"
      AND attachment."status" = 'READY'
  ) THEN
    RAISE EXCEPTION 'formal revision attachment must copy one ready asset from its working copy'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "submission_revision_attachments_contract_guard"
  BEFORE INSERT ON "submission_revision_attachments"
  FOR EACH ROW EXECUTE FUNCTION "enforce_submission_revision_attachment"();

CREATE TRIGGER "submission_revision_attachments_append_only"
  BEFORE UPDATE OR DELETE ON "submission_revision_attachments"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();
