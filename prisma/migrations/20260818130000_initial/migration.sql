-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('EDITING', 'READY_FOR_PREVIEW', 'SEALED');

-- CreateEnum
CREATE TYPE "DraftRevisionSource" AS ENUM ('MANUAL', 'AGENT', 'RESTORE');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActionIntentStatus" AS ENUM ('PREPARED', 'CONFIRMED', 'REJECTED', 'EXECUTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvocationSource" AS ENUM ('UI', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCEEDED', 'DENIED', 'CONFLICTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "app_users" (
    "id" UUID NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "manager_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_memberships" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "classroom_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_drafts" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'EDITING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "learning_objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "task_instructions" TEXT NOT NULL,
    "evidence_requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "feedback_criteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "sealed_at" TIMESTAMPTZ(3),

    CONSTRAINT "activity_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_draft_revisions" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "DraftRevisionSource" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "learning_objectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "task_instructions" TEXT NOT NULL,
    "evidence_requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "feedback_criteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agent_run_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_draft_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_releases" (
    "id" UUID NOT NULL,
    "source_draft_id" UUID NOT NULL,
    "publisher_id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "activity_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_release_snapshots" (
    "release_id" UUID NOT NULL,
    "source_draft_id" UUID NOT NULL,
    "source_draft_version" INTEGER NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_release_snapshots_pkey" PRIMARY KEY ("release_id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "failure_code" TEXT,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_intents" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "agent_run_id" UUID,
    "action_name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "expected_version" INTEGER,
    "status" "ActionIntentStatus" NOT NULL DEFAULT 'PREPARED',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "executed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "command_name" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "resource_type" TEXT,
    "resource_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_audits" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "agent_run_id" UUID,
    "action_intent_id" UUID,
    "source" "InvocationSource" NOT NULL,
    "action_name" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "idempotency_key" TEXT,
    "outcome" "AuditOutcome" NOT NULL,
    "error_code" TEXT,
    "before_version" INTEGER,
    "after_version" INTEGER,
    "result_resource_id" UUID,
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_auth_subject_key" ON "app_users"("auth_subject");

-- CreateIndex
CREATE INDEX "classrooms_manager_id_idx" ON "classrooms"("manager_id");

-- CreateIndex
CREATE INDEX "classroom_memberships_classroom_id_student_id_idx" ON "classroom_memberships"("classroom_id", "student_id");

-- CreateIndex
CREATE INDEX "classroom_memberships_student_id_joined_at_ended_at_idx" ON "classroom_memberships"("student_id", "joined_at", "ended_at");

-- CreateIndex
CREATE INDEX "activity_drafts_owner_id_status_updated_at_idx" ON "activity_drafts"("owner_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "activity_draft_revisions_agent_run_id_idx" ON "activity_draft_revisions"("agent_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_draft_revisions_draft_id_version_key" ON "activity_draft_revisions"("draft_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "activity_releases_source_draft_id_key" ON "activity_releases"("source_draft_id");

-- CreateIndex
CREATE INDEX "activity_releases_classroom_id_status_published_at_idx" ON "activity_releases"("classroom_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "activity_releases_publisher_id_published_at_idx" ON "activity_releases"("publisher_id", "published_at");

-- CreateIndex
CREATE INDEX "activity_release_snapshots_source_draft_id_source_draft_ver_idx" ON "activity_release_snapshots"("source_draft_id", "source_draft_version");

-- CreateIndex
CREATE INDEX "agent_runs_actor_id_started_at_idx" ON "agent_runs"("actor_id", "started_at");

-- CreateIndex
CREATE INDEX "action_intents_actor_id_status_expires_at_idx" ON "action_intents"("actor_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "action_intents_target_type_target_id_idx" ON "action_intents"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "idempotency_records_resource_type_resource_id_idx" ON "idempotency_records"("resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_actor_id_command_name_idempotency_key_key" ON "idempotency_records"("actor_id", "command_name", "idempotency_key");

-- CreateIndex
CREATE INDEX "action_audits_actor_id_created_at_idx" ON "action_audits"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "action_audits_target_type_target_id_created_at_idx" ON "action_audits"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "action_audits_trace_id_idx" ON "action_audits"("trace_id");

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_memberships" ADD CONSTRAINT "classroom_memberships_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_memberships" ADD CONSTRAINT "classroom_memberships_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_drafts" ADD CONSTRAINT "activity_drafts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_revisions" ADD CONSTRAINT "activity_draft_revisions_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "activity_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_draft_revisions" ADD CONSTRAINT "activity_draft_revisions_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_releases" ADD CONSTRAINT "activity_releases_source_draft_id_fkey" FOREIGN KEY ("source_draft_id") REFERENCES "activity_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_releases" ADD CONSTRAINT "activity_releases_publisher_id_fkey" FOREIGN KEY ("publisher_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_releases" ADD CONSTRAINT "activity_releases_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_release_snapshots" ADD CONSTRAINT "activity_release_snapshots_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "activity_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_release_snapshots" ADD CONSTRAINT "activity_release_snapshots_source_draft_id_source_draft_ve_fkey" FOREIGN KEY ("source_draft_id", "source_draft_version") REFERENCES "activity_draft_revisions"("draft_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_intents" ADD CONSTRAINT "action_intents_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_intents" ADD CONSTRAINT "action_intents_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_intents" ADD CONSTRAINT "action_intents_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_audits" ADD CONSTRAINT "action_audits_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_audits" ADD CONSTRAINT "action_audits_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_audits" ADD CONSTRAINT "action_audits_action_intent_id_fkey" FOREIGN KEY ("action_intent_id") REFERENCES "action_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain checks that Prisma cannot express in the schema.
ALTER TABLE "app_users"
  ADD CONSTRAINT "app_users_display_name_not_blank" CHECK (btrim("display_name") <> '');

ALTER TABLE "classrooms"
  ADD CONSTRAINT "classrooms_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "classrooms_version_positive" CHECK ("version" > 0);

ALTER TABLE "classroom_memberships"
  ADD CONSTRAINT "classroom_memberships_valid_interval" CHECK ("ended_at" IS NULL OR "ended_at" > "joined_at");

CREATE UNIQUE INDEX "classroom_memberships_one_active_per_student"
  ON "classroom_memberships" ("classroom_id", "student_id")
  WHERE "ended_at" IS NULL;

ALTER TABLE "activity_drafts"
  ADD CONSTRAINT "activity_drafts_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "activity_drafts_title_not_blank" CHECK (btrim("title") <> ''),
  ADD CONSTRAINT "activity_drafts_summary_not_blank" CHECK (btrim("summary") <> ''),
  ADD CONSTRAINT "activity_drafts_task_not_blank" CHECK (btrim("task_instructions") <> ''),
  ADD CONSTRAINT "activity_drafts_arrays_present" CHECK (
    "learning_objectives" IS NOT NULL
    AND "evidence_requirements" IS NOT NULL
    AND "feedback_criteria" IS NOT NULL
  ),
  ADD CONSTRAINT "activity_drafts_sealed_timestamp" CHECK (
    ("status" = 'SEALED' AND "sealed_at" IS NOT NULL)
    OR ("status" <> 'SEALED' AND "sealed_at" IS NULL)
  );

ALTER TABLE "activity_draft_revisions"
  ADD CONSTRAINT "activity_draft_revisions_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "activity_draft_revisions_title_not_blank" CHECK (btrim("title") <> ''),
  ADD CONSTRAINT "activity_draft_revisions_summary_not_blank" CHECK (btrim("summary") <> ''),
  ADD CONSTRAINT "activity_draft_revisions_task_not_blank" CHECK (btrim("task_instructions") <> ''),
  ADD CONSTRAINT "activity_draft_revisions_arrays_present" CHECK (
    "learning_objectives" IS NOT NULL
    AND "evidence_requirements" IS NOT NULL
    AND "feedback_criteria" IS NOT NULL
  );

ALTER TABLE "activity_releases"
  ADD CONSTRAINT "activity_releases_due_after_publish" CHECK ("due_at" IS NULL OR "due_at" > "published_at"),
  ADD CONSTRAINT "activity_releases_lifecycle" CHECK (
    ("status" = 'ACTIVE' AND "closed_at" IS NULL AND "archived_at" IS NULL)
    OR ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "archived_at" IS NULL)
    OR ("status" = 'ARCHIVED' AND "closed_at" IS NOT NULL AND "archived_at" IS NOT NULL AND "archived_at" >= "closed_at")
  );

ALTER TABLE "activity_release_snapshots"
  ADD CONSTRAINT "activity_release_snapshots_source_version_positive" CHECK ("source_draft_version" > 0),
  ADD CONSTRAINT "activity_release_snapshots_schema_version_positive" CHECK ("schema_version" > 0),
  ADD CONSTRAINT "activity_release_snapshots_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "action_intents"
  ADD CONSTRAINT "action_intents_expire_after_create" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "action_intents_hash_format" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "action_intents_decision_pair" CHECK (
    ("decided_by_id" IS NULL AND "decided_at" IS NULL)
    OR ("decided_by_id" IS NOT NULL AND "decided_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "action_intents_status_timestamps" CHECK (
    ("status" = 'PREPARED' AND "decided_by_id" IS NULL AND "executed_at" IS NULL)
    OR ("status" IN ('CONFIRMED', 'REJECTED') AND "decided_by_id" IS NOT NULL AND "executed_at" IS NULL)
    OR ("status" = 'EXECUTED' AND "decided_by_id" IS NOT NULL AND "executed_at" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "executed_at" IS NULL)
  );

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_key_not_blank" CHECK (btrim("idempotency_key") <> ''),
  ADD CONSTRAINT "idempotency_records_hash_format" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "action_audits"
  ADD CONSTRAINT "action_audits_hash_format" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "action_audits_trace_not_blank" CHECK (btrim("trace_id") <> '');

-- These rows are business history. State changes create new rows instead of
-- overwriting evidence. Migrations may explicitly disable a trigger only when
-- a documented data correction is required.
CREATE FUNCTION "reject_immutable_row_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rows in % are append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "activity_draft_revisions_append_only"
  BEFORE UPDATE OR DELETE ON "activity_draft_revisions"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

CREATE TRIGGER "activity_release_snapshots_append_only"
  BEFORE UPDATE OR DELETE ON "activity_release_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

CREATE TRIGGER "idempotency_records_append_only"
  BEFORE UPDATE OR DELETE ON "idempotency_records"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();

CREATE TRIGGER "action_audits_append_only"
  BEFORE UPDATE OR DELETE ON "action_audits"
  FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_mutation"();
