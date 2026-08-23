import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import {
  activityContentSchema,
  type ActivityContent,
} from "./activity-content";

export function createActivitySnapshot(content: unknown): {
  content: ActivityContent;
  contentHash: string;
} {
  const parsed = activityContentSchema.parse(content);
  const canonicalContent = canonicalize(parsed);

  if (canonicalContent === undefined) {
    throw new TypeError("Activity snapshot cannot be canonicalized");
  }

  return {
    content: parsed,
    contentHash: createHash("sha256").update(canonicalContent).digest("hex"),
  };
}
