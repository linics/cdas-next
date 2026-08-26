import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseStagingEnvironmentFile, readValidatedStagingEnvironmentFile } from "./contracts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture(mode = 0o600): Promise<string> { const directory = await mkdtemp(path.join(tmpdir(), "cdas-config-")); directories.push(directory); const file = path.join(directory, ".env.staging.local"); await writeFile(file, "CDAS_DEVELOPMENT_INFRA_MANAGED=true\n", { mode }); await chmod(file, mode); return directory; }
const ignoredRunner = { run: async () => ({ stdout: "", stderr: "" }) };

describe("ignored development config file", () => {
  it("reads only a root regular 0600 ignored file", async () => { const directory = await fixture(); await expect(readValidatedStagingEnvironmentFile(directory, ignoredRunner)).resolves.toContain("MANAGED"); });
  it("rejects group/world-readable files, symlinks, not-ignored files, and unknown keys", async () => {
    const loose = await fixture(0o644);
    await expect(readValidatedStagingEnvironmentFile(loose, ignoredRunner)).rejects.toThrow("DEVELOPMENT_INFRA_CONFIG_PERMISSIONS_UNSAFE");
    const linked = await fixture(); await symlink(".env.staging.local", path.join(linked, "linked")); await rm(path.join(linked, ".env.staging.local")); await symlink("linked", path.join(linked, ".env.staging.local"));
    await expect(readValidatedStagingEnvironmentFile(linked, ignoredRunner)).rejects.toThrow("DEVELOPMENT_INFRA_CONFIG_FILE_UNSAFE");
    const notIgnored = await fixture(); await expect(readValidatedStagingEnvironmentFile(notIgnored, { run: async () => { throw new Error("no"); } })).rejects.toThrow("DEVELOPMENT_INFRA_CONFIG_NOT_IGNORED");
    expect(() => parseStagingEnvironmentFile("UNRELATED_SECRET=x")).toThrow("DEVELOPMENT_INFRA_CONFIG_UNKNOWN_KEY");
  });
});
