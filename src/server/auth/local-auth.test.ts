import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./local-auth-primitives", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./local-auth-primitives")
  >();
  return {
    ...actual,
    verifyPassword: vi.fn(actual.verifyPassword),
  };
});
import {
  adminIdentifier,
  hashPassword,
  hashSessionToken,
  studentIdentifier,
  authenticate,
  teacherIdentifier,
  verifyPassword,
} from "./local-auth";
import { DUMMY_PASSWORD_HASH } from "./local-auth-primitives";

function fakeDatabase(passwordHash: string) {
  const credential = {
    id: "credential",
    identifier: "admin:operator",
    passwordHash,
    failedLoginCount: 0,
    lockedUntil: null as Date | null,
    mustChangePassword: false,
    user: {
      id: "user",
      role: "ADMIN" as const,
      accountStatus: "ACTIVE" as const,
      school: null,
    },
  };
  const sessions: Array<{ tokenHash: string }> = [];
  const database = {} as {
    localCredential: {
      findUnique: () => Promise<typeof credential>;
      updateMany: (input: { data: Record<string, unknown>; where: { failedLoginCount?: number } }) => Promise<{ count: number }>;
    };
    $transaction: (callback: (value: typeof database) => Promise<unknown>) => Promise<unknown>;
    authSession: { create: (input: { data: { tokenHash: string } }) => Promise<unknown> };
  };
  Object.assign(database, {
    localCredential: {
      findUnique: async () => credential,
      updateMany: async ({ data, where }: { data: Record<string, unknown>; where: { failedLoginCount?: number } }) => {
        if (where.failedLoginCount !== undefined && where.failedLoginCount !== credential.failedLoginCount) return { count: 0 };
        Object.assign(credential, data);
        return { count: 1 };
      },
    },
    $transaction: async (callback: (value: typeof database) => Promise<unknown>) => callback(database),
    authSession: {
      create: async ({ data }: { data: { tokenHash: string } }) => {
        sessions.push(data);
        return data;
      },
    },
  });
  return { database, credential, sessions };
}

describe("local password authentication", () => {
  it("round trips a strict Argon2id envelope and rejects tampering", async () => {
    const encoded = await hashPassword("correct horse9");
    expect(encoded).toMatch(/^\$cdas\$argon2id\$v=1\$m=19456,t=2,p=2\$/u);
    await expect(verifyPassword("correct horse9", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong horse9", encoded)).resolves.toBe(false);
    await expect(verifyPassword("correct horse9", encoded.replace(/([A-Za-z0-9_-]{22})/u, "AAAAAAAAAAAAAAAAAAAAAA"))).resolves.toBe(false);
    await expect(verifyPassword("correct horse9", "$cdas$argon2id$v=2$m=19456,t=2,p=2$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).resolves.toBe(false);
    await expect(verifyPassword("correct horse9", encoded.replace("m=19456", "m=1"))).resolves.toBe(false);
    await expect(verifyPassword("correct horse9", encoded.replace(/\$[^$]+$/u, "$short"))).resolves.toBe(false);
  });

  it("counts Unicode code points for password boundaries", async () => {
    await expect(hashPassword(`a1${"😀".repeat(8)}`)).resolves.toContain("$cdas$");
    await expect(hashPassword(`a1${"😀".repeat(126)}`)).resolves.toContain("$cdas$");
    await expect(hashPassword(`a1${"😀".repeat(127)}`)).rejects.toThrow();
  });

  it("locks on the fifth failed attempt and unlocks at the exact boundary", async () => {
    const fixture = fakeDatabase(await hashPassword("valid password9"));
    const now = new Date("2026-09-01T00:00:00Z");
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(authenticate(fixture.database as never, "admin:operator", "wrong password9", "ADMIN", now)).resolves.toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    }
    expect(fixture.credential.failedLoginCount).toBe(5);
    await expect(authenticate(fixture.database as never, "admin:operator", "valid password9", "ADMIN", now)).resolves.toMatchObject({ ok: false, code: "ACCOUNT_LOCKED" });
    await expect(authenticate(fixture.database as never, "admin:operator", "valid password9", "ADMIN", new Date(now.getTime() + 15 * 60 * 1000))).resolves.toMatchObject({ ok: true });
    expect(fixture.credential.failedLoginCount).toBe(0);
    expect(fixture.sessions).toHaveLength(1);
  });

  it("uses one Argon2 derivation for missing and role-mismatched credentials", async () => {
    const fixture = fakeDatabase(await hashPassword("valid password9"));
    const passwordVerifier = vi.mocked(verifyPassword);
    fixture.database.localCredential.findUnique = async () => null as never;
    passwordVerifier.mockClear();

    await expect(authenticate(
      fixture.database as never,
      "admin:missing",
      "wrong password9",
      "ADMIN",
    )).resolves.toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(passwordVerifier).toHaveBeenCalledOnce();
    expect(passwordVerifier).toHaveBeenLastCalledWith(
      "wrong password9",
      DUMMY_PASSWORD_HASH,
    );

    fixture.database.localCredential.findUnique = async () => fixture.credential;
    passwordVerifier.mockClear();
    await expect(authenticate(
      fixture.database as never,
      "admin:operator",
      "wrong password9",
      "TEACHER",
    )).resolves.toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(passwordVerifier).toHaveBeenCalledOnce();
    expect(passwordVerifier).toHaveBeenLastCalledWith(
      "wrong password9",
      DUMMY_PASSWORD_HASH,
    );
  });

  it("rejects an active lock without deriving or extending it", async () => {
    const fixture = fakeDatabase(await hashPassword("valid password9"));
    const passwordVerifier = vi.mocked(verifyPassword);
    const now = new Date("2026-09-01T00:00:00.000Z");
    fixture.credential.failedLoginCount = 5;
    fixture.credential.lockedUntil = new Date("2026-09-01T00:15:00.000Z");
    passwordVerifier.mockClear();

    await expect(authenticate(
      fixture.database as never,
      "admin:operator",
      "wrong password9",
      "ADMIN",
      now,
    )).resolves.toEqual({ ok: false, code: "ACCOUNT_LOCKED" });
    expect(passwordVerifier).not.toHaveBeenCalled();
    expect(fixture.credential.failedLoginCount).toBe(5);
    expect(fixture.credential.lockedUntil).toEqual(
      new Date("2026-09-01T00:15:00.000Z"),
    );
  });

  it("uses canonical, role-scoped identifiers and hashes session tokens", () => {
    expect(adminIdentifier(" Teacher.Admin ")).toBe("admin:teacher.admin");
    expect(teacherIdentifier("schabc12", "t-01")).toBe("teacher:schabc12:t-01");
    expect(studentIdentifier("schabc12", "000123")).toBe("student:schabc12:000123");
    expect(hashSessionToken("secret")).toMatch(/^[a-f0-9]{64}$/u);
  });
});
