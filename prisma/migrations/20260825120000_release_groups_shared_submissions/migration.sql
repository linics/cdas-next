-- D-032: a submission has exactly one immutable subject: either a student or
-- a group belonging to the same frozen release. Historical personal rows are
-- retained untouched by the nullable group migration.
CREATE TABLE "release_groups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "release_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "release_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "release_groups_release_id_name_key" UNIQUE ("release_id", "name"),
  CONSTRAINT "release_groups_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "activity_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "release_groups_name_nonblank" CHECK (char_length(btrim("name")) > 0)
);

CREATE INDEX "release_groups_release_id_idx" ON "release_groups"("release_id");

CREATE TABLE "release_group_members" (
  "group_id" UUID NOT NULL,
  "student_id" UUID NOT NULL,
  "role_label" VARCHAR(120),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "release_group_members_pkey" PRIMARY KEY ("group_id", "student_id"),
  CONSTRAINT "release_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "release_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "release_group_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "release_group_members_role_label_nonblank" CHECK ("role_label" IS NULL OR char_length(btrim("role_label")) > 0)
);

CREATE INDEX "release_group_members_student_id_idx" ON "release_group_members"("student_id");

ALTER TABLE "submissions" ALTER COLUMN "student_id" DROP NOT NULL;
ALTER TABLE "submissions" ADD COLUMN "group_id" UUID;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "release_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_exactly_one_subject"
  CHECK (("student_id" IS NULL) <> ("group_id" IS NULL));
CREATE UNIQUE INDEX "submissions_release_id_group_id_phase_index_key"
  ON "submissions"("release_id", "group_id", "phase_index") WHERE "group_id" IS NOT NULL;
CREATE INDEX "submissions_group_id_created_at_idx" ON "submissions"("group_id", "created_at");

CREATE OR REPLACE FUNCTION "assert_submission_subject"(
  release_uuid UUID,
  student_uuid UUID,
  group_uuid UUID,
  phase_number INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  group_release_uuid UUID;
BEGIN
  IF (student_uuid IS NULL) = (group_uuid IS NULL) THEN
    RAISE EXCEPTION 'submission must have exactly one subject' USING ERRCODE = '23514';
  END IF;

  IF student_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(release_uuid::TEXT || ':' || student_uuid::TEXT, 0));
    IF EXISTS (
      SELECT 1 FROM "release_group_members" member
      JOIN "release_groups" group_row ON group_row."id" = member."group_id"
      WHERE group_row."release_id" = release_uuid AND member."student_id" = student_uuid
    ) THEN
      RAISE EXCEPTION 'group member cannot create personal submission' USING ERRCODE = '23514';
    END IF;
    PERFORM "assert_submission_phase_scope"(release_uuid, student_uuid, phase_number);
    RETURN;
  END IF;

  SELECT "release_id" INTO group_release_uuid FROM "release_groups" WHERE "id" = group_uuid FOR UPDATE;
  IF NOT FOUND OR group_release_uuid <> release_uuid THEN
    RAISE EXCEPTION 'submission group must belong to release' USING ERRCODE = '23514';
  END IF;

  -- The existing phase helper is subject-keyed. A stable UUID derived from
  -- the group identity lets its prerequisite queries stay isolated from every
  -- student and group without changing historical personal submissions.
  IF EXISTS (
    SELECT 1 FROM "submissions" prerequisite
    WHERE prerequisite."release_id" = release_uuid
      AND prerequisite."group_id" = group_uuid
      AND prerequisite."phase_index" = phase_number - 1
      AND prerequisite."latest_revision_number" > 0
  ) THEN
    NULL;
  END IF;

  -- Reimplement the scope check for group subjects so prerequisites use the
  -- group column rather than a student column.
  DECLARE
    execution_version_value INTEGER;
    content_value JSONB;
    phase_count INTEGER;
    submission_mode TEXT;
  BEGIN
    SELECT release."execution_version", snapshot."content"
      INTO execution_version_value, content_value
      FROM "activity_releases" release JOIN "activity_release_snapshots" snapshot
        ON snapshot."release_id" = release."id"
      WHERE release."id" = release_uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'submission requires a released activity snapshot' USING ERRCODE = '23514'; END IF;
    IF execution_version_value = 0 THEN
      IF phase_number <> 0 THEN RAISE EXCEPTION 'whole-task execution only accepts phase 0' USING ERRCODE = '23514'; END IF;
      RETURN;
    END IF;
    IF execution_version_value <> 1 OR content_value -> 'schemaVersion' <> '2'::JSONB OR jsonb_typeof(content_value -> 'phases') <> 'array' THEN
      RAISE EXCEPTION 'sequential execution requires a schema v2 phase snapshot' USING ERRCODE = '23514';
    END IF;
    phase_count := jsonb_array_length(content_value -> 'phases');
    submission_mode := content_value ->> 'submissionMode';
    IF phase_number = 0 THEN
      IF submission_mode <> 'mixed' OR EXISTS (
        SELECT 1 FROM generate_series(1, phase_count) expected_phase
        WHERE NOT EXISTS (SELECT 1 FROM "submissions" prerequisite
          WHERE prerequisite."release_id" = release_uuid AND prerequisite."group_id" = group_uuid
            AND prerequisite."phase_index" = expected_phase AND prerequisite."latest_revision_number" > 0)
      ) THEN RAISE EXCEPTION 'mixed final submission requires every phase revision' USING ERRCODE = '23514'; END IF;
      RETURN;
    END IF;
    IF submission_mode NOT IN ('phased', 'mixed') OR phase_number < 1 OR phase_number > phase_count THEN
      RAISE EXCEPTION 'submission phase is outside the frozen snapshot' USING ERRCODE = '23514';
    END IF;
    IF phase_number > 1 AND NOT EXISTS (SELECT 1 FROM "submissions" prerequisite
      WHERE prerequisite."release_id" = release_uuid AND prerequisite."group_id" = group_uuid
        AND prerequisite."phase_index" = phase_number - 1 AND prerequisite."latest_revision_number" > 0) THEN
      RAISE EXCEPTION 'submission phase prerequisite is incomplete' USING ERRCODE = '23514';
    END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_submission_container_lifecycle"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'submission containers cannot be deleted' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM "assert_submission_subject"(NEW."release_id", NEW."student_id", NEW."group_id", NEW."phase_index");
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."release_id" IS DISTINCT FROM OLD."release_id"
    OR NEW."student_id" IS DISTINCT FROM OLD."student_id" OR NEW."group_id" IS DISTINCT FROM OLD."group_id"
    OR NEW."phase_index" IS DISTINCT FROM OLD."phase_index" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'submission identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."latest_revision_number" <> OLD."latest_revision_number" AND NEW."latest_revision_number" <> OLD."latest_revision_number" + 1 THEN RAISE EXCEPTION 'submission revisions must advance exactly one step' USING ERRCODE = '55000'; END IF;
  IF NEW."updated_at" < OLD."updated_at" THEN RAISE EXCEPTION 'submission update time cannot move backwards' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_release_group_membership"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE release_uuid UUID; student_role "UserRole"; is_current BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT group_row."release_id" INTO release_uuid FROM "release_groups" group_row
      WHERE group_row."id" = OLD."group_id" FOR UPDATE;
  ELSE
    SELECT group_row."release_id" INTO release_uuid FROM "release_groups" group_row
      WHERE group_row."id" = NEW."group_id" FOR UPDATE;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(release_uuid::TEXT || ':' || NEW."student_id"::TEXT, 0));
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM "submissions" submission WHERE submission."group_id" = NEW."group_id") THEN
    RAISE EXCEPTION 'group membership is locked after submission starts' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM "submissions" submission WHERE submission."group_id" = OLD."group_id") THEN
    RAISE EXCEPTION 'group membership is locked after submission starts' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "submissions" submission WHERE submission."group_id" = OLD."group_id") THEN RAISE EXCEPTION 'group membership is locked after submission starts' USING ERRCODE = '55000'; END IF;
    RETURN OLD;
  END IF;
  SELECT role INTO student_role FROM "app_users" WHERE id = NEW."student_id";
  SELECT EXISTS (SELECT 1 FROM "activity_releases" release JOIN "classroom_memberships" membership ON membership."classroom_id" = release."classroom_id"
    WHERE release."id" = release_uuid AND membership."student_id" = NEW."student_id" AND membership."ended_at" IS NULL) INTO is_current;
  IF student_role <> 'STUDENT' OR NOT is_current THEN RAISE EXCEPTION 'group member must be a current release classroom student' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM "release_group_members" other JOIN "release_groups" other_group ON other_group."id" = other."group_id"
    WHERE other."student_id" = NEW."student_id" AND other_group."release_id" = release_uuid AND other."group_id" <> NEW."group_id") THEN
    RAISE EXCEPTION 'student may belong to only one group per release' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM "submissions" submission WHERE submission."release_id" = release_uuid AND submission."student_id" = NEW."student_id") THEN
    RAISE EXCEPTION 'student with personal submission cannot join release group' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "release_group_members_guard" BEFORE INSERT OR UPDATE OR DELETE ON "release_group_members" FOR EACH ROW EXECUTE FUNCTION "enforce_release_group_membership"();

CREATE FUNCTION "enforce_release_group_lifecycle"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "submissions" WHERE "group_id" = OLD."id") THEN RAISE EXCEPTION 'group is locked after submission starts' USING ERRCODE = '55000'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."release_id" <> OLD."release_id" OR NEW."name" <> OLD."name")
    AND EXISTS (SELECT 1 FROM "submissions" WHERE "group_id" = OLD."id") THEN RAISE EXCEPTION 'group is locked after submission starts' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'UPDATE' AND NEW."release_id" <> OLD."release_id" THEN RAISE EXCEPTION 'group release is immutable' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "release_groups_lifecycle_guard" BEFORE UPDATE OR DELETE ON "release_groups" FOR EACH ROW EXECUTE FUNCTION "enforce_release_group_lifecycle"();

CREATE OR REPLACE FUNCTION "enforce_submission_attachment_lifecycle"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "submissions" submission
      WHERE submission."id" = NEW."submission_id"
        AND (
          (submission."student_id" = NEW."student_id" AND submission."group_id" IS NULL)
          OR EXISTS (SELECT 1 FROM "release_group_members" member
            WHERE member."group_id" = submission."group_id" AND member."student_id" = NEW."student_id")
        )
    ) THEN RAISE EXCEPTION 'attachment uploader must belong to its submission subject' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."submission_id" IS DISTINCT FROM OLD."submission_id"
    OR NEW."student_id" IS DISTINCT FROM OLD."student_id" OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."original_filename" IS DISTINCT FROM OLD."original_filename" OR NEW."media_type" IS DISTINCT FROM OLD."media_type"
    OR NEW."byte_size" IS DISTINCT FROM OLD."byte_size" OR NEW."storage_key" IS DISTINCT FROM OLD."storage_key"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN RAISE EXCEPTION 'attachment identity and declared object metadata are immutable' USING ERRCODE = '55000'; END IF;
  IF NEW."status" = OLD."status" THEN
    IF NEW."uploaded_at" IS DISTINCT FROM OLD."uploaded_at" OR NEW."scanned_at" IS DISTINCT FROM OLD."scanned_at" THEN RAISE EXCEPTION 'attachment timestamps may only advance with status' USING ERRCODE = '55000'; END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD."status" = 'UPLOAD_PENDING' AND NEW."status" = 'SCAN_PENDING') OR (OLD."status" = 'SCAN_PENDING' AND NEW."status" IN ('READY', 'REJECTED'))) THEN RAISE EXCEPTION 'invalid attachment lifecycle transition' USING ERRCODE = '55000'; END IF;
  IF OLD."uploaded_at" IS NOT NULL AND NEW."uploaded_at" IS DISTINCT FROM OLD."uploaded_at" THEN RAISE EXCEPTION 'attachment upload time is immutable once recorded' USING ERRCODE = '55000'; END IF;
  IF OLD."scanned_at" IS NOT NULL AND NEW."scanned_at" IS DISTINCT FROM OLD."scanned_at" THEN RAISE EXCEPTION 'attachment scan time is immutable once recorded' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;
