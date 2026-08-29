import { z } from "zod";

/**
 * Every property name a schema can produce, including nested ones.
 *
 * DeepSeek is used through an OpenAI-compatible `json_object` response format,
 * which does not enforce the schema: the model learns field names only from the
 * prompt. A prompt that stops naming a field silently breaks every call (see
 * D-053), so the contract tests derive the expected names from the schema
 * itself rather than from a list someone has to remember to update.
 */
export function zodFieldNames(schema: z.ZodType): string[] {
  const names = new Set<string>();

  const walk = (node: unknown, depth: number): void => {
    if (depth > 12 || !node || typeof node !== "object") return;
    const def = (node as { def?: Record<string, unknown> }).def;
    if (!def) return;

    const shape = def.shape;
    if (shape && typeof shape === "object") {
      for (const [key, value] of Object.entries(shape)) {
        names.add(key);
        walk(value, depth + 1);
      }
    }
    for (const key of ["element", "innerType", "schema", "in", "out"]) {
      if (def[key]) walk(def[key], depth + 1);
    }
    for (const key of ["options", "items"]) {
      const branch = def[key];
      if (Array.isArray(branch)) {
        branch.forEach((option) => walk(option, depth + 1));
      }
    }
  };

  walk(schema, 0);
  return [...names];
}
