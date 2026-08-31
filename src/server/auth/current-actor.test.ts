import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { cookieStore, findLocalSessionActor } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(() => ({ value: "local-session-token" })) },
  findLocalSessionActor: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("./local-auth", () => ({ LOCAL_SESSION_COOKIE: "cdas_session", findLocalSessionActor }));

import { AuthenticationError, getCurrentActor } from "./current-actor";

const teacher = { id: "00000000-0000-4000-8000-000000000001", authSubject: "local:teacher", role: "TEACHER" as const, displayName: "林老师", accountStatus: "ACTIVE" as const, school: { id: "00000000-0000-4000-8000-000000000010", status: "ACTIVE" as const } };
const database = (mustChangePassword = false) => ({ localCredential: { findUnique: vi.fn(async () => ({ mustChangePassword })) } });

describe("getCurrentActor local sessions", () => {
  it("returns an active teacher backed by an opaque local session", async () => {
    findLocalSessionActor.mockResolvedValueOnce(teacher);
    await expect(getCurrentActor(database() as never)).resolves.toMatchObject(teacher);
    expect(cookieStore.get).toHaveBeenCalledWith("cdas_session");
  });

  it("rejects absent, disabled, disabled-school and password-change-required actors", async () => {
    findLocalSessionActor.mockResolvedValueOnce(null);
    await expect(getCurrentActor(database() as never)).rejects.toEqual(new AuthenticationError("UNAUTHENTICATED"));
    findLocalSessionActor.mockResolvedValueOnce({ ...teacher, accountStatus: "DISABLED" });
    await expect(getCurrentActor(database() as never)).rejects.toEqual(new AuthenticationError("ACCOUNT_DISABLED"));
    findLocalSessionActor.mockResolvedValueOnce({ ...teacher, school: { ...teacher.school, status: "DISABLED" } });
    await expect(getCurrentActor(database() as never)).rejects.toEqual(new AuthenticationError("SCHOOL_DISABLED"));
    findLocalSessionActor.mockResolvedValueOnce(teacher);
    await expect(getCurrentActor(database(true) as never)).rejects.toEqual(new AuthenticationError("PASSWORD_CHANGE_REQUIRED"));
  });

  it("allows the one active platform administrator without a school", async () => {
    findLocalSessionActor.mockResolvedValueOnce({ ...teacher, role: "ADMIN", school: null });
    await expect(getCurrentActor(database() as never)).resolves.toMatchObject({ role: "ADMIN" });
  });
});
