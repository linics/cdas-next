import { describe, expect, it } from "vitest";
import { requireActivePlatformAdmin } from "./admin-authorization";

function databaseWith(
  actor: { role: "ADMIN" | "TEACHER"; accountStatus: "ACTIVE" | "DISABLED" } | null,
) {
  return {
    appUser: {
      findUnique: async () => actor,
    },
  };
}

describe("requireActivePlatformAdmin", () => {
  it("accepts the single active platform admin", async () => {
    await expect(
      requireActivePlatformAdmin(
        databaseWith({ role: "ADMIN", accountStatus: "ACTIVE" }) as never,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({ role: "ADMIN", accountStatus: "ACTIVE" });
  });

  it("rejects teachers and disabled admins", async () => {
    for (const actor of [
      { role: "TEACHER" as const, accountStatus: "ACTIVE" as const },
      { role: "ADMIN" as const, accountStatus: "DISABLED" as const },
      null,
    ]) {
      await expect(
        requireActivePlatformAdmin(
          databaseWith(actor) as never,
          "00000000-0000-4000-8000-000000000001",
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
