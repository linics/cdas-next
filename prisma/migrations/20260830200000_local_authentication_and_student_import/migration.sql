-- Domestic first-party authentication. AppUser remains the owner of all
-- school and teaching authorization; these tables own only local credentials
-- and opaque server sessions.

ALTER TYPE "TeacherProvisioningStatus"
  RENAME VALUE 'CLERK_CREATED' TO 'IDENTITY_CREATED';

ALTER TABLE "teacher_provisionings"
  ALTER COLUMN "clerk_username" TYPE VARCHAR(96);

ALTER TABLE "teacher_provisionings"
  DROP CONSTRAINT IF EXISTS "teacher_provisionings_clerk_username_format";

ALTER TABLE "teacher_provisionings"
  ADD CONSTRAINT "teacher_provisionings_identity_identifier_format"
    CHECK ("clerk_username" ~ '^[a-z][a-z0-9:_-]{3,95}$');

ALTER TABLE "app_users"
  DROP CONSTRAINT IF EXISTS "app_users_student_no_format";

ALTER TABLE "app_users"
  ADD CONSTRAINT "app_users_student_no_format"
    CHECK ("student_no" IS NULL OR "student_no" ~ '^[0-9]{6,32}$');

CREATE TABLE "local_credentials" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "identifier" VARCHAR(96) NOT NULL,
  "password_hash" VARCHAR(256) NOT NULL,
  "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  "password_changed_at" TIMESTAMPTZ(3),
  "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "local_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "local_credentials_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "local_credentials_identifier_key" UNIQUE ("identifier"),
  CONSTRAINT "local_credentials_identifier_format"
    CHECK ("identifier" ~ '^[a-z][a-z0-9:_-]{3,95}$'),
  CONSTRAINT "local_credentials_password_hash_not_blank"
    CHECK (btrim("password_hash") <> '')
);

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "auth_sessions_expiry_after_creation"
    CHECK ("expires_at" > "created_at")
);

ALTER TABLE "local_credentials"
  ADD CONSTRAINT "local_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "local_credentials_locked_until_idx"
  ON "local_credentials" ("locked_until");
CREATE INDEX "auth_sessions_user_id_revoked_at_expires_at_idx"
  ON "auth_sessions" ("user_id", "revoked_at", "expires_at");
CREATE INDEX "auth_sessions_expires_at_idx"
  ON "auth_sessions" ("expires_at");
