import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDevelopmentQuickSession,
  isDevelopmentQuickLoginEnabled,
} from "./development-quick-login";

function fakeDatabase(userId: string | null) {
  const createdSessions: Array<{ userId: string }> = [];
  return {
    createdSessions,
    database: {
      localCredential: {
        findFirst: vi.fn().mockResolvedValue(userId ? { userId } : null),
      },
      authSession: {
        create: vi.fn(async ({ data }: { data: { userId: string } }) => {
          createdSessions.push(data);
          return data;
        }),
      },
    },
  };
}

describe("development quick login", () => {
  it("is available only to Next development", () => {
    expect(isDevelopmentQuickLoginEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isDevelopmentQuickLoginEnabled({ NODE_ENV: "development", E2E_RUN_MARKER: "run-001" })).toBe(false);
    expect(isDevelopmentQuickLoginEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(isDevelopmentQuickLoginEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("creates an ordinary session only for an eligible default teacher", async () => {
    const fixture = fakeDatabase("10000000-0000-4000-8000-000000000001");
    const environment = process.env as Record<string, string | undefined>;
    const previous = environment.NODE_ENV;
    environment.NODE_ENV = "development";
    try {
      const result = await createDevelopmentQuickSession(
        fixture.database as never,
        "TEACHER",
        new Date("2026-09-01T00:00:00.000Z"),
      );

      expect(result.ok).toBe(true);
      expect(fixture.database.localCredential.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            identifier: "teacher:scharchx:t-demo",
            mustChangePassword: false,
            user: expect.objectContaining({ role: "TEACHER", accountStatus: "ACTIVE" }),
          }),
        }),
      );
      expect(fixture.createdSessions).toHaveLength(1);
    } finally {
      if (previous === undefined) delete environment.NODE_ENV;
      else environment.NODE_ENV = previous;
    }
  });

  it("does not create a session when no active default account exists", async () => {
    const fixture = fakeDatabase(null);
    const environment = process.env as Record<string, string | undefined>;
    const previous = environment.NODE_ENV;
    environment.NODE_ENV = "development";
    try {
      await expect(
        createDevelopmentQuickSession(fixture.database as never, "STUDENT"),
      ).resolves.toEqual({ ok: false, code: "DEFAULT_ACCOUNT_UNAVAILABLE" });
      expect(fixture.createdSessions).toHaveLength(0);
    } finally {
      if (previous === undefined) delete environment.NODE_ENV;
      else environment.NODE_ENV = previous;
    }
  });
});
