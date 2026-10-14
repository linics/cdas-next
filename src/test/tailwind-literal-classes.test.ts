import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Tailwind generates a class only when it can read the whole class in the
// source. A variant prefix interpolated into a template literal — a constant
// holding "group-data-[surface=panel]/assistant" joined to ":min-h-0" — never
// reaches the stylesheet, which left the assistant panel without scrolling.
const interpolatedVariant = /\$\{[A-Za-z_][A-Za-z0-9_]*\}:[A-Za-z[!&-]/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(full);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [full] : [];
  });
}

describe("Tailwind class literals", () => {
  it("never builds a variant prefix at runtime", () => {
    const offenders = sourceFiles(path.join(process.cwd(), "src")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          interpolatedVariant.test(line) ? [`${path.relative(process.cwd(), file)}:${index + 1}`] : [],
        ),
    );

    expect(offenders).toEqual([]);
  });
});
