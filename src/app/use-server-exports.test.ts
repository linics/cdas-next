import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(path) && !/\.test\.tsx?$/u.test(path) ? [path] : [];
  });
}

/**
 * Next only lets a "use server" module export async functions. Exporting a
 * plain value from one compiles and renders, then fails with a 500 the first
 * time the form is submitted — a failure no page test catches.
 */
describe('"use server" modules', () => {
  it("export nothing but functions", () => {
    const offenders = sourceFiles(appRoot)
      .filter((path) => /^\s*["']use server["']/u.test(readFileSync(path, "utf8")))
      .filter((path) =>
        /^export\s+(const|let|var)\s/mu.test(readFileSync(path, "utf8")),
      )
      .map((path) => path.slice(process.cwd().length + 1));
    expect(offenders).toEqual([]);
  });
});
