import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";

vi.mock("server-only", () => ({}));

import {
  requireActiveTeacher,
  TeacherAuthorizationError,
} from "./teacher-authorization";

function databaseWith(
  actor:
    | {
        role: "TEACHER" | "ADMIN";
        accountStatus: "ACTIVE" | "DISABLED";
        schoolId: string | null;
        school: { status: "ACTIVE" | "DISABLED" } | null;
      }
    | null,
) {
  return {
    appUser: { findUnique: async () => actor },
  } as unknown as PrismaClient;
}

describe("teacher command authorization", () => {
  it("returns the active teacher's school boundary", async () => {
    await expect(
      requireActiveTeacher(
        databaseWith({
          role: "TEACHER",
          accountStatus: "ACTIVE",
          schoolId: "00000000-0000-4000-8000-000000000010",
          school: { status: "ACTIVE" },
        }),
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({ schoolId: "00000000-0000-4000-8000-000000000010" });
  });

  it("refuses non-teachers, disabled accounts, and disabled schools", async () => {
    for (const actor of [
      { role: "ADMIN" as const, accountStatus: "ACTIVE" as const, schoolId: null, school: null },
      { role: "TEACHER" as const, accountStatus: "DISABLED" as const, schoolId: "00000000-0000-4000-8000-000000000010", school: { status: "ACTIVE" as const } },
      { role: "TEACHER" as const, accountStatus: "ACTIVE" as const, schoolId: "00000000-0000-4000-8000-000000000010", school: { status: "DISABLED" as const } },
    ]) {
      await expect(
        requireActiveTeacher(
          databaseWith(actor),
          "00000000-0000-4000-8000-000000000001",
        ),
      ).rejects.toEqual(new TeacherAuthorizationError("FORBIDDEN"));
    }
  });
});
