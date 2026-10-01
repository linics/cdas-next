import { z } from "zod";

/**
 * What students' answers to one phase have in common (D-086). The model only
 * describes what the answers say; every point must quote the answers it rests
 * on, and a quote that is not literally in the answer is thrown away. That is
 * the whole defence against a summary that sounds right and is made up.
 */

/** Fewer answers than this is not a pattern; the teacher can read them. */
export const ANSWER_THEMES_MIN_ANSWERS = 3;
/** A class's worth; beyond this the newest answers are read. */
export const ANSWER_THEMES_MAX_ANSWERS = 60;
/** Per-answer cut-off before the text goes to the model. */
export const ANSWER_THEMES_MAX_ANSWER_CHARS = 3_000;
export const ANSWER_THEMES_MAX_THEMES = 6;
const QUOTE_MIN_CHARS = 4;
const QUOTE_MAX_CHARS = 80;

export const answerThemeKinds = [
  { code: "STRENGTH", label: "多数做到了" },
  { code: "GAP", label: "多数没做到" },
] as const;

export type AnswerThemeKind = (typeof answerThemeKinds)[number]["code"];

export const answerThemeKindLabels = Object.fromEntries(
  answerThemeKinds.map((item) => [item.code, item.label]),
) as Record<AnswerThemeKind, string>;

const kindSchema = z.enum(
  answerThemeKinds.map((item) => item.code) as [AnswerThemeKind, ...AnswerThemeKind[]],
);

export const answerThemesModelOutputSchema = z
  .object({
    summary: z.string().trim().min(6).max(400),
    themes: z
      .array(
        z
          .object({
            kind: kindSchema,
            statement: z.string().trim().min(4).max(200),
            evidence: z
              .array(
                z
                  .object({
                    answer: z.int().positive(),
                    quote: z.string().trim().min(1).max(200),
                  })
                  .strict(),
              )
              .min(1)
              .max(8),
          })
          .strict(),
      )
      .max(ANSWER_THEMES_MAX_THEMES),
  })
  .strict();

export type AnswerThemesModelOutput = z.infer<typeof answerThemesModelOutputSchema>;

/** Stored shape: each quote is pinned to the exact revision it came from. */
export const storedAnswerThemesSchema = z
  .array(
    z
      .object({
        kind: kindSchema,
        statement: z.string(),
        sources: z
          .array(
            z
              .object({
                submissionId: z.uuid(),
                revisionId: z.uuid(),
                quote: z.string(),
              })
              .strict(),
          )
          .min(2),
      })
      .strict(),
  )
  .max(ANSWER_THEMES_MAX_THEMES);

export type StoredAnswerTheme = z.infer<typeof storedAnswerThemesSchema>[number];

export type AnswerForThemes = Readonly<{
  submissionId: string;
  revisionId: string;
  text: string;
}>;

export class AnswerThemesOutputError extends Error {
  constructor(public readonly code: "UNGROUNDED") {
    super(code);
    this.name = "AnswerThemesOutputError";
  }
}

/** Whitespace and full/half-width punctuation differences are not misquotes. */
function normalize(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

/** The text as the model sees it; quotes are checked against the same cut. */
export function answerTextForModel(text: string): string {
  const chars = Array.from(text.trim());
  return chars.length <= ANSWER_THEMES_MAX_ANSWER_CHARS
    ? chars.join("")
    : chars.slice(0, ANSWER_THEMES_MAX_ANSWER_CHARS).join("");
}

/**
 * Keep only what the answers actually say.
 *
 * - A quote must be a literal excerpt of the answer it names.
 * - A theme is "common" only if it still rests on two different answers.
 * - If the model offered themes and none survive, the whole summary is
 *   rejected: its overall sentence would be describing things nobody wrote.
 */
export function resolveAnswerThemes(
  answers: readonly AnswerForThemes[],
  output: AnswerThemesModelOutput,
): StoredAnswerTheme[] {
  const normalizedAnswers = answers.map((answer) =>
    normalize(answerTextForModel(answer.text)),
  );
  const themes = output.themes.flatMap((theme): StoredAnswerTheme[] => {
    const seen = new Set<string>();
    const sources = theme.evidence.flatMap((item) => {
      const answer = answers[item.answer - 1];
      const haystack = normalizedAnswers[item.answer - 1];
      const quote = normalize(item.quote);
      const length = Array.from(quote).length;
      if (
        !answer ||
        haystack === undefined ||
        seen.has(answer.submissionId) ||
        length < QUOTE_MIN_CHARS ||
        length > QUOTE_MAX_CHARS ||
        !haystack.includes(quote)
      ) {
        return [];
      }
      seen.add(answer.submissionId);
      return [
        {
          submissionId: answer.submissionId,
          revisionId: answer.revisionId,
          quote: item.quote.trim(),
        },
      ];
    });
    return sources.length >= 2
      ? [{ kind: theme.kind, statement: theme.statement, sources }]
      : [];
  });
  if (output.themes.length > 0 && themes.length === 0) {
    throw new AnswerThemesOutputError("UNGROUNDED");
  }
  return themes;
}
