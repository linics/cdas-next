import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

const cookieState = vi.hoisted(() => ({ token: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === "cdas_session" && cookieState.token
      ? { name, value: cookieState.token }
      : undefined,
    set: vi.fn(),
  }),
}));

import {
  hashTeacherInvite,
  teacherIdentifier,
} from "../../domain/school/identity";
import { createDatabaseClient } from "../db/client";
import { issueTeacherOneTimePassword } from "../commands/admin-teacher-commands";
import type { CommandContext } from "../commands/command-context";
import { registerTeacherWithInvite } from "../commands/register-teacher";
import { AuthenticationError, getCurrentActor } from "./current-actor";
import {
  adminIdentifier,
  authenticate,
  changeLocalPassword,
  createAuthSession,
  getSession,
  hashPassword,
  hashSessionToken,
  studentIdentifier,
  verifyPassword,
} from "./local-auth";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const password = "Cdas-auth-test9a";
const schoolCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSchoolCode(): string {
  const bytes = randomBytes(5);
  return `SCH${[...bytes].map((byte) =>
    schoolCodeAlphabet[byte % schoolCodeAlphabet.length]).join("")}`;
}

function randomStudentNo(): string {
  return randomBytes(8).readBigUInt64BE().toString().padStart(20, "0");
}

async function createSchool(status: "ACTIVE" | "DISABLED" = "ACTIVE") {
  return database!.school.create({
    data: {
      code: randomSchoolCode(),
      name: `Local auth test school ${randomUUID()}`,
      teacherInviteCodeHash: "a".repeat(64),
      status,
    },
  });
}

async function createLocalUser(input: Readonly<{
  role: "ADMIN" | "TEACHER" | "STUDENT";
  accountStatus?: "ACTIVE" | "DISABLED";
  schoolStatus?: "ACTIVE" | "DISABLED";
  mustChangePassword?: boolean;
}>) {
  if (input.role === "ADMIN") {
    const existing = await database!.appUser.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    if (existing) {
      const identifier = adminIdentifier(`admin-${randomUUID().slice(0, 8)}`);
      const passwordHash = await hashPassword(password);
      await database!.appUser.update({
        where: { id: existing.id },
        data: { accountStatus: input.accountStatus ?? "ACTIVE" },
      });
      await database!.localCredential.upsert({
        where: { userId: existing.id },
        create: {
          userId: existing.id,
          identifier,
          passwordHash,
        },
        update: {
          identifier,
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          mustChangePassword: false,
        },
      });
      return {
        id: existing.id,
        identifier,
        school: null,
        staffNo: null,
        studentNo: null,
      };
    }
  }
  const id = randomUUID();
  const school = input.role === "ADMIN"
    ? null
    : await createSchool(input.schoolStatus);
  const staffNo = input.role === "TEACHER"
    ? `T-${randomUUID().slice(0, 8)}`.toUpperCase()
    : null;
  const studentNo = input.role === "STUDENT" ? randomStudentNo() : null;
  const identifier = input.role === "ADMIN"
    ? adminIdentifier(`admin-${randomUUID().slice(0, 8)}`)
    : input.role === "TEACHER"
      ? teacherIdentifier(school!.code, staffNo!)
      : studentIdentifier(school!.code, studentNo!);
  await database!.appUser.create({
    data: {
      id,
      authSubject: `local:${id}`,
      role: input.role,
      displayName: `Local ${input.role}`,
      accountStatus: input.accountStatus ?? "ACTIVE",
      schoolId: school?.id,
      staffNo,
      studentNo,
    },
  });
  await database!.localCredential.create({
    data: {
      userId: id,
      identifier,
      passwordHash: await hashPassword(password),
      mustChangePassword: input.mustChangePassword ?? false,
    },
  });
  return { id, identifier, school, staffNo, studentNo };
}

function context(actorId: string, now = new Date()): CommandContext {
  return {
    actorId,
    source: "UI",
    traceId: randomUUID(),
    clock: () => now,
  };
}

describeWithDatabase("local authentication database boundary", () => {
  afterAll(async () => {
    cookieState.token = "";
    await database?.$disconnect();
  });

  it("stores only the SHA-256 session token hash after a successful login", async () => {
    const user = await createLocalUser({ role: "TEACHER" });
    const result = await authenticate(
      database!,
      user.identifier,
      password,
      "TEACHER",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = await database!.authSession.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(stored.tokenHash).toBe(hashSessionToken(result.token));
    expect(stored.tokenHash).not.toBe(result.token);
    expect(JSON.stringify(stored)).not.toContain(result.token);
  });

  it("locks on the fifth failure and clears the counter after the lock expires", async () => {
    const user = await createLocalUser({ role: "STUDENT" });
    const now = new Date("2026-09-01T00:00:00.000Z");
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(authenticate(
        database!,
        user.identifier,
        "Cdas-wrong-password9",
        "STUDENT",
        now,
      )).resolves.toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    }
    const locked = await database!.localCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(locked.failedLoginCount).toBe(5);
    expect(locked.lockedUntil).toEqual(new Date("2026-09-01T00:15:00.000Z"));
    await expect(authenticate(
      database!,
      user.identifier,
      password,
      "STUDENT",
      new Date("2026-09-01T00:14:59.999Z"),
    )).resolves.toMatchObject({ ok: false, code: "ACCOUNT_LOCKED" });
    await expect(authenticate(
      database!,
      user.identifier,
      password,
      "STUDENT",
      new Date("2026-09-01T00:15:00.000Z"),
    )).resolves.toMatchObject({ ok: true });
    await expect(database!.localCredential.findUniqueOrThrow({
      where: { userId: user.id },
      select: { failedLoginCount: true, lockedUntil: true },
    })).resolves.toEqual({ failedLoginCount: 0, lockedUntil: null });
  });

  it("rejects expired and revoked sessions", async () => {
    const user = await createLocalUser({ role: "TEACHER" });
    const createdAt = new Date("2026-09-01T00:00:00.000Z");
    const expired = await createAuthSession(database!, user.id, createdAt);
    await expect(getSession(
      database!,
      expired.token,
      new Date(expired.expiresAt.getTime() + 1),
    )).resolves.toBeNull();

    const revoked = await createAuthSession(database!, user.id);
    await database!.authSession.update({
      where: { tokenHash: hashSessionToken(revoked.token) },
      data: { revokedAt: new Date() },
    });
    await expect(getSession(database!, revoked.token)).resolves.toBeNull();
  });

  it("revokes every old session on password change and returns one fresh session", async () => {
    const user = await createLocalUser({ role: "STUDENT" });
    const first = await authenticate(
      database!,
      user.identifier,
      password,
      "STUDENT",
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await createAuthSession(database!, user.id);
    const changed = await changeLocalPassword(
      database!,
      user.id,
      "Cdas-new-password9",
    );
    await expect(getSession(database!, first.token)).resolves.toBeNull();
    await expect(getSession(database!, second.token)).resolves.toBeNull();
    await expect(getSession(database!, changed.token)).resolves.not.toBeNull();
    const credential = await database!.localCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    await expect(verifyPassword(password, credential.passwordHash)).resolves.toBe(false);
    await expect(verifyPassword(
      "Cdas-new-password9",
      credential.passwordHash,
    )).resolves.toBe(true);
  });

  it("rejects disabled accounts at login and current-actor boundaries", async () => {
    const user = await createLocalUser({
      role: "STUDENT",
      accountStatus: "DISABLED",
    });
    await expect(authenticate(
      database!,
      user.identifier,
      password,
      "STUDENT",
    )).resolves.toMatchObject({ ok: false, code: "ACCOUNT_DISABLED" });
    const session = await createAuthSession(database!, user.id);
    cookieState.token = session.token;
    await expect(getCurrentActor(database!)).rejects.toMatchObject({
      code: "ACCOUNT_DISABLED",
    } satisfies Pick<AuthenticationError, "code">);
  });

  it("rejects disabled schools twice while allowing a schoolless admin", async () => {
    const teacher = await createLocalUser({
      role: "TEACHER",
      schoolStatus: "DISABLED",
    });
    await expect(authenticate(
      database!,
      teacher.identifier,
      password,
      "TEACHER",
    )).resolves.toMatchObject({ ok: false, code: "SCHOOL_DISABLED" });
    const teacherSession = await createAuthSession(database!, teacher.id);
    cookieState.token = teacherSession.token;
    await expect(getCurrentActor(database!)).rejects.toMatchObject({
      code: "SCHOOL_DISABLED",
    });

    const admin = await createLocalUser({ role: "ADMIN" });
    const login = await authenticate(
      database!,
      admin.identifier,
      password,
      "ADMIN",
    );
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    cookieState.token = login.token;
    await expect(getCurrentActor(database!)).resolves.toMatchObject({
      id: admin.id,
      role: "ADMIN",
      schoolId: null,
    });
  });

  it("isolates a teacher identifier by school code", async () => {
    const teacher = await createLocalUser({ role: "TEACHER" });
    const otherSchool = await createSchool();
    await expect(authenticate(
      database!,
      teacherIdentifier(otherSchool.code, teacher.staffNo!),
      password,
      "TEACHER",
    )).resolves.toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
  });

  it("claims a pending teacher exactly and safely replays the invite submission", async () => {
    const inviteCode = `invite-${randomUUID()}`;
    const school = await createSchool();
    await database!.school.update({
      where: { id: school.id },
      data: { teacherInviteCodeHash: hashTeacherInvite(inviteCode) },
    });
    const teacherId = randomUUID();
    const provisioningId = randomUUID();
    const staffNo = `P-${randomUUID().slice(0, 8)}`.toUpperCase();
    await database!.appUser.create({
      data: {
        id: teacherId,
        authSubject: `pending:${provisioningId}`,
        role: "TEACHER",
        displayName: "Pending Teacher",
        schoolId: school.id,
        staffNo,
        teacherProvisioning: {
          create: {
            id: provisioningId,
            schoolId: school.id,
            staffNo,
            displayName: "Pending Teacher",
          },
        },
      },
    });
    const input = {
      schoolCode: school.code,
      inviteCode,
      staffNo,
      displayName: "Pending Teacher",
      password: "Cdas-invite-password9",
    };
    const claimed = await registerTeacherWithInvite(database!, input);
    const replay = await registerTeacherWithInvite(database!, input);
    expect(claimed).toEqual({ teacherId, provisioningId, status: "CLAIMED" });
    expect(replay).toEqual(claimed);
    await expect(database!.appUser.findUniqueOrThrow({
      where: { id: teacherId },
      select: {
        authSubject: true,
        teacherProvisioning: {
          select: { status: true, completedAt: true },
        },
      },
    })).resolves.toMatchObject({
      authSubject: `local:${teacherId}`,
      teacherProvisioning: {
        status: "COMPLETED",
        completedAt: expect.any(Date),
      },
    });
  });

  it("issues one-time teacher credentials without persisting plaintext", async () => {
    const admin = await createLocalUser({ role: "ADMIN" });
    const school = await createSchool();
    const teacherId = randomUUID();
    const provisioningId = randomUUID();
    const staffNo = `I-${randomUUID().slice(0, 8)}`.toUpperCase();
    await database!.appUser.create({
      data: {
        id: teacherId,
        authSubject: `pending:${provisioningId}`,
        role: "TEACHER",
        displayName: "Issued Teacher",
        schoolId: school.id,
        staffNo,
        teacherProvisioning: {
          create: {
            id: provisioningId,
            schoolId: school.id,
            staffNo,
            displayName: "Issued Teacher",
          },
        },
      },
    });
    const idempotencyKey = `issue_${randomUUID()}`;
    const issued = await issueTeacherOneTimePassword(
      database!,
      context(admin.id),
      { teacherId, idempotencyKey },
    );
    await expect(issueTeacherOneTimePassword(
      database!,
      context(admin.id),
      { teacherId, idempotencyKey },
    )).rejects.toMatchObject({ code: "PASSWORD_ALREADY_ISSUED" });
    const credential = await database!.localCredential.findUniqueOrThrow({
      where: { userId: teacherId },
    });
    expect(credential.mustChangePassword).toBe(true);
    await expect(authenticate(
      database!,
      teacherIdentifier(school.code, staffNo),
      issued.oneTimePassword,
      "TEACHER",
    )).resolves.toMatchObject({ ok: true, mustChangePassword: true });
    const [records, audits] = await Promise.all([
      database!.idempotencyRecord.findMany({
        where: { actorId: admin.id, commandName: "issue_teacher_password" },
      }),
      database!.actionAudit.findMany({
        where: { actorId: admin.id, actionName: "issue_teacher_password" },
      }),
    ]);
    expect(JSON.stringify({ records, audits })).not.toContain(issued.oneTimePassword);
    expect(JSON.stringify({ records, audits })).not.toContain(credential.passwordHash);
    expect(await database!.appUser.findUniqueOrThrow({
      where: { id: teacherId },
      select: { authSubject: true },
    })).toEqual({ authSubject: `local:${teacherId}` });
  });
});
