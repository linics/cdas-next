import { describe, expect, it } from "vitest";
import {
  isActiveSchoolMember,
  requireActiveSchoolMember,
} from "./teacher-authorization";

function databaseWith(
  actor: {
    role: "TEACHER" | "ADMIN";
    accountStatus: "ACTIVE" | "DISABLED";
    schoolId: string | null;
    school: { status: "ACTIVE" | "DISABLED" } | null;
  } | null,
) {
  return {
    appUser: {
      findUnique: async () => actor,
    },
  };
}

describe("requireActiveSchoolMember", () => {
  it("returns the school for an active teacher in an active school", async () => {
    await expect(
      requireActiveSchoolMember(
        databaseWith({
          role: "TEACHER",
          accountStatus: "ACTIVE",
          schoolId: "00000000-0000-4000-8000-000000000010",
          school: { status: "ACTIVE" },
        }) as never,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toEqual({ schoolId: "00000000-0000-4000-8000-000000000010" });
  });

  it("rejects disabled accounts, disabled schools, and admins", async () => {
    for (const actor of [
      {
        role: "TEACHER" as const,
        accountStatus: "DISABLED" as const,
        schoolId: "00000000-0000-4000-8000-000000000010",
        school: { status: "ACTIVE" as const },
      },
      {
        role: "TEACHER" as const,
        accountStatus: "ACTIVE" as const,
        schoolId: "00000000-0000-4000-8000-000000000010",
        school: { status: "DISABLED" as const },
      },
      {
        role: "ADMIN" as const,
        accountStatus: "ACTIVE" as const,
        schoolId: null,
        school: null,
      },
    ]) {
      await expect(
        requireActiveSchoolMember(
          databaseWith(actor) as never,
          "00000000-0000-4000-8000-000000000001",
        ),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/DISABLED|FORBIDDEN/u),
      });
    }
  });

  it("offers a boolean gate for shared command boundaries", async () => {
    await expect(
      isActiveSchoolMember(
        databaseWith({
          role: "TEACHER",
          accountStatus: "DISABLED",
          schoolId: "00000000-0000-4000-8000-000000000010",
          school: { status: "ACTIVE" },
        }) as never,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe(false);
  });
});
