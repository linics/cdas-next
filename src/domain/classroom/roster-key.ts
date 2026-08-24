import { z } from "zod";

const normalizedRosterKeySchema = z
  .string()
  .regex(/^[A-Z0-9]{8,32}$/u);

export function normalizeRosterKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/gu, "");
}

export const rosterKeySchema = z
  .string()
  .transform(normalizeRosterKey)
  .pipe(normalizedRosterKeySchema);

export function parseRosterKeyList(value: string): Readonly<{
  keys: string[];
  duplicates: string[];
}> {
  const candidates = value
    .split(/[\s,，;；]+/u)
    .map(normalizeRosterKey)
    .filter(Boolean);
  if (candidates.length === 0 || candidates.length > 50) {
    throw new Error("ROSTER_KEY_COUNT_INVALID");
  }
  const keys: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = normalizedRosterKeySchema.parse(candidate);
    if (seen.has(key)) {
      if (!duplicates.includes(key)) duplicates.push(key);
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return { keys, duplicates };
}
