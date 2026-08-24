-- A roster key is an operator-managed reference for an existing student
-- account. It is not an authentication credential and never grants access by
-- itself; teacher membership commands still authorize the classroom manager.
ALTER TABLE "app_users"
  ADD COLUMN "roster_key" VARCHAR(32);

ALTER TABLE "app_users"
  ADD CONSTRAINT "app_users_roster_key_student_only"
    CHECK ("roster_key" IS NULL OR "role" = 'STUDENT'),
  ADD CONSTRAINT "app_users_roster_key_format"
    CHECK ("roster_key" IS NULL OR "roster_key" ~ '^[A-Z0-9]{8,32}$');

CREATE UNIQUE INDEX "app_users_roster_key_key"
  ON "app_users" ("roster_key");

CREATE FUNCTION "enforce_app_user_roster_key_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."roster_key" IS NOT NULL
    AND NEW."roster_key" IS DISTINCT FROM OLD."roster_key" THEN
    RAISE EXCEPTION 'assigned roster key is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "app_users_roster_key_history_guard"
  BEFORE UPDATE ON "app_users"
  FOR EACH ROW EXECUTE FUNCTION "enforce_app_user_roster_key_history"();
