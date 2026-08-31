import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { bootstrapAdminCliHelp, parseBootstrapAdminCliArguments } from "./bootstrap-admin-cli";

describe("local admin bootstrap CLI boundary", () => {
  it("requires database confirmation but never accepts a username or password as a command-line value", () => {
    expect(parseBootstrapAdminCliArguments(["--confirm-database", "cdas_next"])).toEqual({ kind: "run", confirmedDatabase: "cdas_next" });
    expect(bootstrapAdminCliHelp).toContain("interactively asks");
    expect(() => parseBootstrapAdminCliArguments(["--username", "admin", "--confirm-database", "cdas_next"])).toThrow(TypeError);
  });
});
