import { z } from "zod";

export const MAX_TEXT_EVIDENCE_CODE_POINTS = 20_000;

// Variation selectors modify a preceding visible grapheme, but have no visible
// meaning on their own. Keep this list aligned with
// cdas_text_has_visible_content() in the PostgreSQL migration.
const ignorableOnlyPattern =
  /^[\p{White_Space}\p{Cf}\p{Variation_Selector}]*$/u;

export function normalizeTextEvidence(value: string): string {
  return value.replace(/\r\n?/g, "\n").normalize("NFC");
}

export function hasMeaningfulTextEvidence(value: string): boolean {
  return !ignorableOnlyPattern.test(normalizeTextEvidence(value));
}

export const workingTextEvidenceSchema = z
  .string()
  .transform(normalizeTextEvidence)
  .superRefine((value, context) => {
    if ([...value].length > MAX_TEXT_EVIDENCE_CODE_POINTS) {
      context.addIssue({
        code: "too_big",
        maximum: MAX_TEXT_EVIDENCE_CODE_POINTS,
        origin: "string",
        inclusive: true,
        message: `Text evidence cannot exceed ${MAX_TEXT_EVIDENCE_CODE_POINTS} Unicode characters`,
      });
    }
  });
