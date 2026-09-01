import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value ? { name, value } : undefined;
    },
    set: vi.fn(),
  }),
}));

import { hashSessionToken } from "./local-auth";
import { AuthenticationError, getCurrentActor } from "./current-actor";

const token = "A".repeat(43);
type ActorFixture = Readonly<{
  id: string;
  authSubject: string;
  role: "TEACHER";
  displayName: string;
  accountStatus: "ACTIVE" | "DISABLED";
  schoolId: string;
  school: { status: "ACTIVE" | "DISABLED" };
  localCredential: { mustChangePassword: boolean };
}>;

const teacher: ActorFixture = {
  id: "teacher-row",
  authSubject: "local:teacher-row",
  role: "TEACHER" as const,
  displayName: "林老师",
  accountStatus: "ACTIVE" as const,
  schoolId: "school-row",
  school: { status: "ACTIVE" as const },
  localCredential: { mustChangePassword: false },
};

function databaseDouble(
  session: typeof teacher | null = teacher,
  options: Readonly<{ expiresAt?: Date; revokedAt?: Date | null }> = {},
) {
  return {
    authSession: {
      findFirst: vi.fn(async ({ where }: {
        where: {
          tokenHash: string;
          revokedAt: null;
          expiresAt: { gt: Date };
        };
      }) => {
        if (!session || where.tokenHash !== hashSessionToken(token)) return null;
        const expiresAt = options.expiresAt ?? new Date("2099-01-01T00:00:00Z");
        if (options.revokedAt || expiresAt <= where.expiresAt.gt) return null;
        return { user: session, expiresAt, revokedAt: null };
      }),
    },
  };
}

describe("getCurrentActor local session", () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a missing, forged, expired, or revoked cookie", async () => {
    await expect(getCurrentActor(databaseDouble() as never)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    } satisfies Pick<AuthenticationError, "code">);

    cookieStore.set("cdas_session", "forged");
    await expect(getCurrentActor(databaseDouble() as never)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    cookieStore.set("cdas_session", token);
    await expect(getCurrentActor(databaseDouble(teacher, {
      expiresAt: new Date("2000-01-01T00:00:00Z"),
    }) as never)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(getCurrentActor(databaseDouble(teacher, {
      revokedAt: new Date(),
    }) as never)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("returns an active actor for a valid local session", async () => {
    cookieStore.set("cdas_session", token);
    await expect(getCurrentActor(databaseDouble() as never)).resolves.toMatchObject({
      id: teacher.id,
      role: "TEACHER",
    });
  });

  it("enforces account, school, and mandatory-password-change gates", async () => {
    cookieStore.set("cdas_session", token);
    await expect(getCurrentActor(databaseDouble({
      ...teacher,
      accountStatus: "DISABLED",
    }) as never)).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
    await expect(getCurrentActor(databaseDouble({
      ...teacher,
      school: { status: "DISABLED" },
    }) as never)).rejects.toMatchObject({ code: "SCHOOL_DISABLED" });
    await expect(getCurrentActor(databaseDouble({
      ...teacher,
      localCredential: { mustChangePassword: true },
    }) as never)).rejects.toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
  });
});
