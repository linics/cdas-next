import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";

vi.mock("server-only", () => ({}));

import {
  AdminAuthorizationError,
  requireActivePlatformAdmin,
} from "./admin-authorization";

function databaseWith(actor: { role: "ADMIN" | "TEACHER"; accountStatus: "ACTIVE" | "DISABLED" } | null) {
  return {
    appUser: {
      findUnique: async () => actor,
    },
  } as unknown as PrismaClient;
}

describe("platform admin authorization", () => {
  it("returns an active platform admin", async () => {
    await expect(
      requireActivePlatformAdmin(
        databaseWith({ role: "ADMIN", accountStatus: "ACTIVE" }),
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({ role: "ADMIN", accountStatus: "ACTIVE" });
  });

  it("does not grant administrative access to teachers, disabled accounts, or missing users", async () => {
    for (const actor of [
      { role: "TEACHER" as const, accountStatus: "ACTIVE" as const },
      { role: "ADMIN" as const, accountStatus: "DISABLED" as const },
      null,
    ]) {
      await expect(
        requireActivePlatformAdmin(
          databaseWith(actor),
          "00000000-0000-4000-8000-000000000001",
        ),
      ).rejects.toEqual(new AdminAuthorizationError("FORBIDDEN"));
    }
  });
});
