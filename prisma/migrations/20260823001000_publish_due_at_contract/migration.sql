-- Publish confirmations must carry an unambiguous ISO instant that can be
-- represented exactly by the millisecond-precision ActivityRelease column.
-- The release-integrity trigger still compares the parsed instant with the
-- stored due_at; this check rejects ambiguous or lossy payloads earlier.
CREATE FUNCTION "cdas_publish_due_at_is_valid"(payload_value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  due_at_text TEXT;
BEGIN
  IF NOT payload_value ? 'dueAt' THEN
    RETURN FALSE;
  END IF;

  IF payload_value -> 'dueAt' = 'null'::JSONB THEN
    RETURN TRUE;
  END IF;

  IF jsonb_typeof(payload_value -> 'dueAt') <> 'string' THEN
    RETURN FALSE;
  END IF;

  due_at_text := payload_value ->> 'dueAt';
  IF due_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RETURN FALSE;
  END IF;

  BEGIN
    PERFORM due_at_text::TIMESTAMPTZ;
  EXCEPTION
    WHEN invalid_datetime_format
      OR invalid_text_representation
      OR datetime_field_overflow
      OR numeric_value_out_of_range THEN
      RETURN FALSE;
  END;

  RETURN TRUE;
END;
$$;

-- Pre-upgrade ActionIntents are immutable business history and may contain a
-- formerly accepted high-precision value. Validate only new rows; the existing
-- ActionIntent freeze trigger already forbids changing action_name or payload,
-- while status-only transitions on historical rows remain possible.
CREATE FUNCTION "enforce_new_publish_due_at_contract"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."action_name" = 'publish_activity_release'
    AND NOT "cdas_publish_due_at_is_valid"(NEW."payload") THEN
    RAISE EXCEPTION 'publish ActionIntent % requires an offset ISO dueAt with at most millisecond precision', NEW."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "action_intents_publish_due_at_contract"
BEFORE INSERT ON "action_intents"
FOR EACH ROW
EXECUTE FUNCTION "enforce_new_publish_due_at_contract"();
