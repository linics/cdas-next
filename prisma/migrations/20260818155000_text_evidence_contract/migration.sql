-- Keep database checks aligned with the server's Unicode-aware evidence
-- contract. PostgreSQL 17 regular expressions do not expose Unicode general
-- categories, so this immutable helper combines POSIX whitespace with the
-- relevant format/zero-width code-point ranges.
CREATE FUNCTION "cdas_text_has_visible_content"(value TEXT)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  character TEXT;
  codepoint INTEGER;
BEGIN
  IF char_length(value) = 0 OR char_length(value) > 20000 THEN
    RETURN false;
  END IF;

  FOR character IN
    SELECT regexp_split_to_table(value, '')
  LOOP
    codepoint := ascii(character);

    IF character ~ '^[[:space:]]$'
      OR codepoint IN (133, 160, 173, 847, 1564, 6158, 65279)
      OR codepoint BETWEEN 1536 AND 1541
      OR codepoint = 1757
      OR codepoint = 1807
      OR codepoint BETWEEN 2192 AND 2193
      OR codepoint = 2274
      OR codepoint BETWEEN 8203 AND 8207
      OR codepoint BETWEEN 8234 AND 8238
      OR codepoint BETWEEN 8288 AND 8292
      OR codepoint BETWEEN 8294 AND 8303
      OR codepoint BETWEEN 65024 AND 65039
      OR codepoint BETWEEN 65529 AND 65531
      OR codepoint IN (69821, 69837)
      OR codepoint BETWEEN 78896 AND 78911
      OR codepoint BETWEEN 113824 AND 113827
      OR codepoint BETWEEN 119155 AND 119162
      OR codepoint = 917505
      OR codepoint BETWEEN 917536 AND 917631
      OR codepoint BETWEEN 917760 AND 917999 THEN
      CONTINUE;
    END IF;

    RETURN true;
  END LOOP;

  RETURN false;
END;
$$;

ALTER TABLE "submission_working_copies"
  ADD CONSTRAINT "submission_working_copies_text_length" CHECK (
    char_length("text_evidence") <= 20000
  );

ALTER TABLE "submission_revisions"
  DROP CONSTRAINT "submission_revisions_text_not_blank",
  ADD CONSTRAINT "submission_revisions_text_contract" CHECK (
    "cdas_text_has_visible_content"("text_evidence")
  );
