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
  CONSTRAINT "local_credentials_identifier_format" CHECK (
    "identifier" ~ '^(admin:[a-z0-9][a-z0-9._-]{0,63}|teacher:(sch[a-hj-np-z2-9]{5}|scharchx):[a-z0-9][a-z0-9-]{0,31}|student:(sch[a-hj-np-z2-9]{5}|scharchx):[0-9]{6,32})$'
  ),
  CONSTRAINT "local_credentials_password_hash_not_blank" CHECK (btrim("password_hash") <> ''),
  CONSTRAINT "local_credentials_failed_login_count_nonnegative" CHECK ("failed_login_count" >= 0)
);
CREATE INDEX "local_credentials_locked_until_idx" ON "local_credentials"("locked_until");
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "auth_sessions_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "auth_sessions_expires_after_created" CHECK ("expires_at" > "created_at")
);
CREATE INDEX "auth_sessions_user_id_revoked_at_expires_at_idx"
  ON "auth_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "teacher_provisionings"
  ADD CONSTRAINT "teacher_provisionings_pending_completed_at_null"
  CHECK ("status" <> 'PENDING' OR "completed_at" IS NULL);
