-- School-level organization boundary. This migration deliberately leaves every
-- activity, release, submission, feedback, evaluation, and snapshot table
-- untouched: school ownership is derived through classrooms and users.

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "SchoolStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "TeacherProvisioningStatus" AS ENUM (
  'PENDING',
  'CLERK_CREATED',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "schools" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "code" VARCHAR(16) NOT NULL,
  "teacher_invite_code_hash" CHAR(64) NOT NULL,
  "status" "SchoolStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "app_users"
  ADD COLUMN "school_id" UUID,
  ADD COLUMN "staff_no" VARCHAR(32),
  ADD COLUMN "student_no" VARCHAR(32),
  ADD COLUMN "primary_discipline_code" VARCHAR(32),
  ADD COLUMN "secondary_discipline_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "legacy_profile" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "classrooms"
  ADD COLUMN "school_id" UUID;

CREATE TABLE "teacher_provisionings" (
  "id" UUID NOT NULL,
  "school_id" UUID NOT NULL,
  "staff_no" VARCHAR(32) NOT NULL,
  "display_name" TEXT NOT NULL,
  "primary_discipline_code" VARCHAR(32) NOT NULL,
  "secondary_discipline_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "clerk_username" VARCHAR(64) NOT NULL,
  "clerk_user_id" TEXT,
  "app_user_id" UUID,
  "status" "TeacherProvisioningStatus" NOT NULL DEFAULT 'PENDING',
  "failure_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),

  CONSTRAINT "teacher_provisionings_pkey" PRIMARY KEY ("id")
);

-- Existing deployments have no organizational data. A permanently-addressable
-- legacy school preserves all historic IDs and lets the new boundary be added
-- without rewriting immutable teaching records.
INSERT INTO "schools" (
  "id",
  "name",
  "code",
  "teacher_invite_code_hash",
  "status",
  "created_at",
  "updated_at"
) VALUES (
  '00000000-0000-0000-0000-000000000101',
  '历史迁移学校',
  'LEGACY01',
  repeat('0', 64),
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

UPDATE "app_users"
SET
  "school_id" = '00000000-0000-0000-0000-000000000101',
  "legacy_profile" = true;

UPDATE "classrooms" AS classroom
SET "school_id" = manager."school_id"
FROM "app_users" AS manager
WHERE manager."id" = classroom."manager_id";

ALTER TABLE "classrooms"
  ALTER COLUMN "school_id" SET NOT NULL;

ALTER TABLE "schools"
  ADD CONSTRAINT "schools_code_key" UNIQUE ("code"),
  ADD CONSTRAINT "schools_name_not_blank"
    CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "schools_code_format"
    CHECK ("code" ~ '^[A-Z][A-Z0-9]{4,15}$'),
  ADD CONSTRAINT "schools_teacher_invite_hash_format"
    CHECK ("teacher_invite_code_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "app_users"
  ADD CONSTRAINT "app_users_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "app_users_staff_no_format"
    CHECK ("staff_no" IS NULL OR "staff_no" ~ '^[A-Z0-9][A-Z0-9-]{0,31}$'),
  ADD CONSTRAINT "app_users_student_no_format"
    CHECK ("student_no" IS NULL OR "student_no" ~ '^[A-Z0-9][A-Z0-9-]{0,31}$'),
  ADD CONSTRAINT "app_users_school_role_shape"
    CHECK (
      (
        "role" = 'ADMIN'
        AND "school_id" IS NULL
        AND "staff_no" IS NULL
        AND "student_no" IS NULL
        AND "primary_discipline_code" IS NULL
        AND cardinality("secondary_discipline_codes") = 0
        AND "legacy_profile" = false
      )
      OR (
        "role" = 'TEACHER'
        AND "school_id" IS NOT NULL
        AND "student_no" IS NULL
        AND (
          "legacy_profile" = true
          OR (
            "staff_no" IS NOT NULL
            AND "primary_discipline_code" IS NOT NULL
          )
        )
      )
      OR (
        "role" = 'STUDENT'
        AND "school_id" IS NOT NULL
        AND "staff_no" IS NULL
        AND "primary_discipline_code" IS NULL
        AND cardinality("secondary_discipline_codes") = 0
      )
    );

ALTER TABLE "classrooms"
  ADD CONSTRAINT "classrooms_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_provisionings"
  ADD CONSTRAINT "teacher_provisionings_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_provisionings_app_user_id_fkey"
    FOREIGN KEY ("app_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "teacher_provisionings_staff_no_format"
    CHECK ("staff_no" ~ '^[A-Z0-9][A-Z0-9-]{0,31}$'),
  ADD CONSTRAINT "teacher_provisionings_display_name_not_blank"
    CHECK (btrim("display_name") <> ''),
  ADD CONSTRAINT "teacher_provisionings_discipline_not_blank"
    CHECK (btrim("primary_discipline_code") <> ''),
  ADD CONSTRAINT "teacher_provisionings_clerk_username_format"
    CHECK ("clerk_username" ~ '^[a-z][a-z0-9_]{3,63}$'),
  ADD CONSTRAINT "teacher_provisionings_completed_shape"
    CHECK (
      "status" <> 'COMPLETED'
      OR (
        "clerk_user_id" IS NOT NULL
        AND "app_user_id" IS NOT NULL
        AND "failure_code" IS NULL
        AND "completed_at" IS NOT NULL
      )
    );

ALTER TABLE "app_users"
  ADD CONSTRAINT "app_users_school_staff_no_key" UNIQUE ("school_id", "staff_no"),
  ADD CONSTRAINT "app_users_school_student_no_key" UNIQUE ("school_id", "student_no");

ALTER TABLE "teacher_provisionings"
  ADD CONSTRAINT "teacher_provisionings_school_staff_no_key" UNIQUE ("school_id", "staff_no"),
  ADD CONSTRAINT "teacher_provisionings_clerk_username_key" UNIQUE ("clerk_username"),
  ADD CONSTRAINT "teacher_provisionings_clerk_user_id_key" UNIQUE ("clerk_user_id"),
  ADD CONSTRAINT "teacher_provisionings_app_user_id_key" UNIQUE ("app_user_id");

CREATE INDEX "app_users_school_id_role_account_status_idx"
  ON "app_users" ("school_id", "role", "account_status");
CREATE INDEX "classrooms_school_id_manager_id_idx"
  ON "classrooms" ("school_id", "manager_id");
CREATE INDEX "teacher_provisionings_school_id_status_created_at_idx"
  ON "teacher_provisionings" ("school_id", "status", "created_at");

-- The platform has exactly one operator account. School administrators are out
-- of scope for this MVP, so a second ADMIN must be rejected by the database.
CREATE UNIQUE INDEX "app_users_single_admin"
  ON "app_users" (("role"))
  WHERE "role" = 'ADMIN';

CREATE FUNCTION "enforce_school_code_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."code" IS DISTINCT FROM OLD."code" THEN
    RAISE EXCEPTION 'school code is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "schools_code_immutable_guard"
  BEFORE UPDATE ON "schools"
  FOR EACH ROW EXECUTE FUNCTION "enforce_school_code_immutable"();

CREATE FUNCTION "enforce_app_user_school_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."school_id" IS NOT NULL
    AND NEW."school_id" IS DISTINCT FROM OLD."school_id" THEN
    RAISE EXCEPTION 'user school assignment is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "app_users_school_immutable_guard"
  BEFORE UPDATE ON "app_users"
  FOR EACH ROW EXECUTE FUNCTION "enforce_app_user_school_immutable"();

CREATE FUNCTION "enforce_classroom_school_boundary"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "app_users" AS manager
    WHERE manager."id" = NEW."manager_id"
      AND manager."role" = 'TEACHER'
      AND manager."school_id" = NEW."school_id"
  ) THEN
    RAISE EXCEPTION 'classroom manager must be a teacher in the classroom school'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "classrooms_school_boundary_guard"
  BEFORE INSERT OR UPDATE OF "manager_id", "school_id" ON "classrooms"
  FOR EACH ROW EXECUTE FUNCTION "enforce_classroom_school_boundary"();

CREATE FUNCTION "enforce_classroom_membership_school_boundary"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "classrooms" AS classroom
    JOIN "app_users" AS student ON student."id" = NEW."student_id"
    WHERE classroom."id" = NEW."classroom_id"
      AND student."role" = 'STUDENT'
      AND student."school_id" = classroom."school_id"
  ) THEN
    RAISE EXCEPTION 'classroom member must be a student in the classroom school'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "classroom_memberships_school_boundary_guard"
  BEFORE INSERT OR UPDATE OF "classroom_id", "student_id" ON "classroom_memberships"
  FOR EACH ROW EXECUTE FUNCTION "enforce_classroom_membership_school_boundary"();
