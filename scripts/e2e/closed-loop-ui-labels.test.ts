import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The browser gates click and wait on the UI by its visible words. Neither runs
 * in `pnpm check` — one needs a dev server, the other a paid model — so when a
 * page renames a button, nothing fails until someone next runs the gate. Between
 * the v3 task book (D-061) and the review redesign (D-079) that went unnoticed
 * for five weeks: the login button, the draft form, the roster's row action and
 * the feedback save buttons had all moved, and the real-model smoke could not
 * get past its first step.
 *
 * This reads every label the closed-loop script waits on and checks the words
 * still exist somewhere in the UI source. It cannot prove the words belong to
 * the same element — only the browser run proves that — but a renamed or
 * deleted label fails here, the day it happens, for free.
 */

const script = readFileSync("scripts/e2e/run-closed-loop.py", "utf8");

/** Calls whose string arguments are UI the script expects to find. */
const lookupCalls = [
  "get_by_role",
  "get_by_label",
  "get_by_text",
  "filter",
  "locator",
  "confirm_dialog",
  "dialog_titled",
  "wait_for_text",
  "form_field",
];

/** Loops whose tuples list UI words to assert, not words the script types. */
const lookupLoops = ["label", "heading", "action_label", "expected"];

const cjk = /[㐀-鿿]/;

function callSpans(source: string, names: readonly string[]): string[] {
  const spans: string[] = [];
  const start = new RegExp(String.raw`\b(?:${names.join("|")})\(`, "g");
  for (const match of source.matchAll(start)) {
    let depth = 0;
    let quote: string | null = null;
    let index = match.index + match[0].length - 1;
    for (; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")" && --depth === 0) break;
    }
    spans.push(source.slice(match.index, index + 1));
  }
  return spans;
}

type Literal = Readonly<{ text: string; regex: boolean; css: boolean }>;

function literals(span: string): Literal[] {
  const found: Literal[] = [];
  const pattern = /(re\.compile\(\s*)?(?<!\w)(rf|fr|r|f)?("|')((?:(?!\3)[^\\\n]|\\.)*)\3/g;
  for (const match of span.matchAll(pattern)) {
    const prefix = match[2] ?? "";
    found.push({
      text: match[4],
      regex: Boolean(match[1]) || prefix.includes("r"),
      css: match[3] === "'",
    });
  }
  return found;
}

/** The fixed words in one literal; runtime values and syntax drop out. */
function fragments(literal: Literal): string[] {
  if (literal.css) {
    return [...literal.text.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
  }
  let text = literal.text.replace(/\{[^}]*\}/g, "\u0000");
  if (literal.regex) {
    text = text
      .replace(/\\d\+|\\s\*|\\s\+|\.\*|\^|\$/g, "\u0000")
      .replace(/\\(.)/g, "$1")
      .replace(/\|/g, "\u0000");
  }
  return text
    .split(/\u0000|\d+/)
    .map((part) => part.trim())
    .filter((part) => cjk.test(part));
}

function expectedUiWords(): Map<string, string> {
  const words = new Map<string, string>();
  const add = (literal: Literal) => {
    for (const fragment of fragments(literal)) words.set(fragment, literal.text);
  };
  for (const span of callSpans(script, lookupCalls)) {
    literals(span).forEach(add);
  }
  // Module constants name the labels used in more than one place.
  for (const match of script.matchAll(/^[A-Z][A-Z0-9_]* = (.+)$/gm)) {
    literals(match[1]).forEach(add);
  }
  const loop = new RegExp(
    String.raw`for (?:${lookupLoops.join("|")}) in \(([\s\S]*?)\):`,
    "g",
  );
  for (const match of script.matchAll(loop)) {
    literals(match[1]).forEach(add);
  }
  return words;
}

function uiSource(): string {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        files.push(full);
      }
    }
  };
  walk("src/app");
  walk("src/components");
  walk("src/domain");
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

describe("closed-loop browser script", () => {
  it("only waits on words the UI still renders", () => {
    const source = uiSource();
    const words = expectedUiWords();
    const missing = [...words]
      .filter(([fragment]) => !source.includes(fragment))
      .map(([fragment, literal]) => `${fragment}  (from "${literal}")`);

    // Guard the guard: an extractor that silently found nothing would pass.
    expect(words.size).toBeGreaterThan(60);
    expect(missing).toEqual([]);
  });

  it("would notice a renamed label", () => {
    const words = expectedUiWords();
    expect(words.has("进入工作台")).toBe(true);
    expect(words.has("保存 · 请学生修改")).toBe(true);
    expect(words.has("确认并保存最终反馈")).toBe(true);
    expect(words.has("草稿改写确认")).toBe(true);
  });
});
