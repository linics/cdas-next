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
 * v2 is deliberately serialized in PostgreSQL jsonb's stable textual order.
 * The release-integrity trigger can therefore recalculate the same hash from
 * the immutable JSON task book without implementing a second JSON standard.
 * v1 remains on canonicalize@4 and is intentionally untouched.
 */
export function canonicalizeActivityContentV2(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeActivityContentV2).join(", ")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(postgresJsonbKeyOrder)
    .map((key) => `${JSON.stringify(key)}: ${canonicalizeActivityContentV2(record[key])}`)
    .join(", ")}}`;
}

export function createActivitySnapshot(content: unknown): {
  content: ActivityContent;
  contentHash: string;
} {
  const parsed = activityContentSchema.parse(content);
  const canonicalContent =
    parsed.schemaVersion === 1
      ? canonicalize(parsed)
      : canonicalizeActivityContentV2(parsed);

  if (canonicalContent === undefined) {
    throw new TypeError("Activity snapshot cannot be canonicalized");
  }

  return {
    content: parsed,
    contentHash: createHash("sha256").update(canonicalContent).digest("hex"),
  };
}
