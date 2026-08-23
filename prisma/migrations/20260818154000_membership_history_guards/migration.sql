-- Membership intervals are authorization history. PostgreSQL's exclusion
-- constraint closes the concurrency race that a read-then-insert check would
-- leave between overlapping intervals.
CREATE EXTENSION IF NOT EXISTS "btree_gist";

ALTER TABLE "classroom_memberships"
  ADD CONSTRAINT "classroom_memberships_no_overlapping_intervals"
  EXCLUDE USING gist (
    "classroom_id" WITH =,
    "student_id" WITH =,
    tstzrange(
      "joined_at",
      COALESCE("ended_at", 'infinity'::timestamptz),
      '[)'
    ) WITH &&
  );

CREATE FUNCTION "enforce_classroom_membership_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'classroom membership history cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."classroom_id" IS DISTINCT FROM OLD."classroom_id"
    OR NEW."student_id" IS DISTINCT FROM OLD."student_id"
    OR NEW."joined_at" IS DISTINCT FROM OLD."joined_at" THEN
    RAISE EXCEPTION 'classroom membership identity and join time are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."ended_at" IS NOT NULL
    AND NEW."ended_at" IS DISTINCT FROM OLD."ended_at" THEN
    RAISE EXCEPTION 'ended classroom membership history is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "classroom_memberships_history_guard"
  BEFORE UPDATE OR DELETE ON "classroom_memberships"
  FOR EACH ROW EXECUTE FUNCTION "enforce_classroom_membership_history"();
