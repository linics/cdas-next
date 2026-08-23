import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const explicitFiles = [
  "next.config.ts", "package.json", "pnpm-lock.yaml", "postcss.config.mjs",
  "prisma.config.ts", "prisma.test.config.ts", "tsconfig.json", "scripts/staging/source-fingerprint.ts",
] as const;

function sourceFiles(directory: string, relative = "src"): string[] {
  const absolute = path.join(directory, relative);
  const entries = readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      return /(?:^|\/)(?:generated|__tests__|test)$/u.test(child) ? [] : sourceFiles(directory, child);
    }
    return entry.isFile() && !/\.(?:test|integration\.test)\.tsx?$/u.test(entry.name)
      ? [child]
      : [];
  });
}

function prismaFiles(directory: string): string[] {
  const root = path.join(directory, "prisma");
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "schema.prisma" && entry.isFile()) return ["prisma/schema.prisma"];
    if (entry.name !== "migrations" || !entry.isDirectory()) return [];
    return readdirSync(path.join(root, entry.name), { withFileTypes: true })
      .filter((migration) => migration.isDirectory())
      .map((migration) => `prisma/migrations/${migration.name}/migration.sql`);
  });
}

function publicFiles(directory: string, relative = "public"): string[] {
  const absolute = path.join(directory, relative);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) return publicFiles(directory, child);
    return entry.isFile() ? [child] : [];
  });
}

export function fingerprintFiles(root = process.cwd()): string[] {
  const files = [
    ...sourceFiles(root),
    ...publicFiles(root),
    ...prismaFiles(root),
    ...explicitFiles,
  ].sort();
  for (const file of files) {
    if (!statSync(path.join(root, file)).isFile()) throw new Error("SOURCE_FINGERPRINT_INPUT_MISSING");
  }
  return files;
}

export function sourceFingerprintFromEntries(entries: readonly Readonly<{ path: string; bytes: Uint8Array }>[]): string {
  const hash = createHash("sha256");
  hash.update("cdas-source-fingerprint-v1\0", "utf8");
  for (const entry of [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  )) {
    const pathBytes = Buffer.from(entry.path.replaceAll(path.sep, "/"), "utf8");
    const frame = Buffer.alloc(12);
    frame.writeUInt32BE(pathBytes.byteLength, 0);
    frame.writeBigUInt64BE(BigInt(entry.bytes.byteLength), 4);
    hash.update(frame);
    hash.update(pathBytes);
    hash.update(entry.bytes);
  }
  return hash.digest("hex");
}

export function createSourceFingerprint(root = process.cwd()): string {
  return sourceFingerprintFromEntries(fingerprintFiles(root).map((file) => ({
    path: file,
    bytes: readFileSync(path.join(root, file)),
  })));
}
