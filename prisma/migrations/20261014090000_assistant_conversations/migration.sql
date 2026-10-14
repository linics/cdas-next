-- D-099: assistant conversations saved after each reply.
-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "messages" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_owner_id_updated_at_idx" ON "assistant_conversations"("owner_id", "updated_at");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A conversation is a list of messages no larger than a request may carry,
-- with some headroom for the reply that was added to it.
ALTER TABLE "assistant_conversations"
  ADD CONSTRAINT "assistant_conversations_messages_shape"
  CHECK (jsonb_typeof("messages") = 'array' AND octet_length("messages"::text) <= 1000000),
  ADD CONSTRAINT "assistant_conversations_title_length"
  CHECK (char_length("title") <= 80),
  ADD CONSTRAINT "assistant_conversations_updated_after_create"
  CHECK ("updated_at" >= "created_at");
