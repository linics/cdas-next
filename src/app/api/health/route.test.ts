import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("reports a local-auth ready state without requiring external credentials", async () => {
    const original = { ...process.env };
    process.env.DATABASE_URL = "postgresql://local:secret@database:5432/cdas_next";
    process.env.AI_PROVIDER_DISABLED = "1";
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", authentication: "local", ai: "disabled" });
    process.env = original;
  });

  it("fails closed when database configuration is absent", async () => {
    const original = { ...process.env };
    delete process.env.DATABASE_URL;
    process.env.AI_PROVIDER_DISABLED = "1";
    const response = GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unconfigured" });
    process.env = original;
  });
});
