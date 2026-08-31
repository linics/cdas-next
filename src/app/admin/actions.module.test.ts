import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const serverActionPaths = [
  fileURLToPath(new URL("./actions.ts", import.meta.url)),
  fileURLToPath(new URL("../teacher/identity-actions.ts", import.meta.url)),
];

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

describe("admin server action module", () => {
  it("keeps every local server-action module free of runtime values other than async functions", async () => {
    const invalidRuntimeExports = [] as string[];
    for (const path of serverActionPaths) {
      const sourceText = await readFile(path, "utf8");
      const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
      for (const statement of sourceFile.statements) {
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
        if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
        if (!ts.isFunctionDeclaration(statement) || !hasModifier(statement, ts.SyntaxKind.AsyncKeyword)) {
          invalidRuntimeExports.push(`${path}: ${statement.getText(sourceFile)}`);
        }
      }
    }

    expect(invalidRuntimeExports).toEqual([]);
  });
});
