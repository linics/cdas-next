import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import {
  activityContentSchema,
  type ActivityContent,
} from "./activity-content";

function postgresJsonbKeyOrder(left: string, right: string): number {
  const leftBytes = Buffer.byteLength(left, "utf8");
  const rightBytes = Buffer.byteLength(right, "utf8");
  if (leftBytes !== rightBytes) return leftBytes - rightBytes;
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

/**
 * Structured task books are deliberately serialized in PostgreSQL jsonb's
 * stable textual order.
 * The release-integrity trigger can therefore recalculate the same hash from
 * the immutable JSON task book without implementing a second JSON standard.
 * v1 remains on canonicalize@4 and is intentionally untouched.
 */
export function canonicalizeStructuredActivityContent(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeStructuredActivityContent).join(", ")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(postgresJsonbKeyOrder)
    .map((key) => `${JSON.stringify(key)}: ${canonicalizeStructuredActivityContent(record[key])}`)
    .join(", ")}}`;
}

/** Kept for v2 callers and historical hash-contract tests. */
export const canonicalizeActivityContentV2 = canonicalizeStructuredActivityContent;

export function createActivitySnapshot(content: unknown): {
  content: ActivityContent;
  contentHash: string;
} {
  const parsed = activityContentSchema.parse(content);
  const canonicalContent =
    parsed.schemaVersion === 1
      ? canonicalize(parsed)
      : canonicalizeStructuredActivityContent(parsed);

  if (canonicalContent === undefined) {
    throw new TypeError("Activity snapshot cannot be canonicalized");
  }

  return {
    content: parsed,
    contentHash: createHash("sha256").update(canonicalContent).digest("hex"),
  };
}
