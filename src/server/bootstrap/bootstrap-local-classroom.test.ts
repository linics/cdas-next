import { describe, expect, it, vi } from "vitest";

vi.mock("../auth/local-auth-primitives", () => ({
  hashPassword: vi.fn(async (password: string) => `hash:${password}`),
  studentIdentifier: (_school: string, number: string) =>
    `student:scharchx:${number}`,
  teacherIdentifier: (_school: string, staff: string) =>
    `teacher:scharchx:${staff.toLowerCase()}`,
}));

import {
  bootstrapLocalClassroom,
  bootstrapLocalClassroomResultSchema,
} from "./bootstrap-local-classroom";

function fixtureDatabase() {
  const users = new Map<string, {
    id: string;
    role: "TEACHER" | "STUDENT";
    displayName: string;
    rosterKey?: string;
    authSubject: string;
    schoolId: string;
    staffNo?: string;
    studentNo?: string;
  }>();
  const credentials = new Map<string, {
    userId: string;
    identifier: string;
    passwordHash: string;
    user: {
      id: string;
      role: "TEACHER" | "STUDENT";
      displayName: string;
      rosterKey?: string;
      authSubject: string;
      schoolId: string;
      staffNo?: string;
      studentNo?: string;
    };
  }>();
  let classroom: { id: string; managerId: string; name: string } | undefined;
  let membership: { id: string; classroomId: string; studentId: string } | undefined;
  const revokedUserIds: string[] = [];
  const database = {} as {
    $transaction: (callback: (transaction: never) => Promise<unknown>) => Promise<unknown>;
    $queryRaw: () => Promise<never[]>;
    appUser: {
      create: (input: unknown) => Promise<unknown>;
      update: (input: unknown) => Promise<unknown>;
    };
    localCredential: {
      findUnique: (input: unknown) => Promise<unknown>;
      create: (input: unknown) => Promise<unknown>;
      update: (input: unknown) => Promise<unknown>;
    };
    authSession: {
      updateMany: (input: unknown) => Promise<unknown>;
    };
    classroom: {
      findUnique: (input: unknown) => Promise<unknown>;
      create: (input: unknown) => Promise<unknown>;
    };
    classroomMembership: {
      findFirst: (input: unknown) => Promise<unknown>;
      create: (input: unknown) => Promise<unknown>;
    };
  };
  Object.assign(database, {
    $transaction: async (callback: (transaction: never) => Promise<unknown>) => callback(database as never),
    $queryRaw: async () => [],
    appUser: {
      create: async ({ data }: { data: {
        id: string;
        role: "TEACHER" | "STUDENT";
        displayName: string;
        rosterKey?: string;
        authSubject: string;
        schoolId: string;
        staffNo?: string;
        studentNo?: string;
      } }) => {
        const user = {
          id: data.id,
          role: data.role,
          displayName: data.displayName,
          rosterKey: data.rosterKey,
          authSubject: data.authSubject,
          schoolId: data.schoolId,
          staffNo: data.staffNo,
          studentNo: data.studentNo,
        };
        users.set(user.id, user);
        return user;
      },
      update: async ({ where, data }: { where: { id: string }; data: { rosterKey?: string } }) => {
        const user = users.get(where.id);
        if (user && data.rosterKey) user.rosterKey = data.rosterKey;
        return user;
      },
    },
    localCredential: {
      findUnique: async ({ where }: { where: { identifier: string } }) => {
        const credential = credentials.get(where.identifier);
        if (!credential) return null;
        return { user: credential.user };
      },
      create: async ({ data }: { data: { userId: string; identifier: string; passwordHash: string } }) => {
        const user = users.get(data.userId);
        if (!user) throw new Error("USER_NOT_FOUND");
        credentials.set(data.identifier, { ...data, user });
        return data;
      },
      update: async ({ where, data }: { where: { userId: string }; data: { passwordHash: string } }) => {
        const credential = [...credentials.values()].find((entry) => entry.userId === where.userId);
        if (!credential) throw new Error("CREDENTIAL_NOT_FOUND");
        credential.passwordHash = data.passwordHash;
        return credential;
      },
    },
    authSession: {
      updateMany: async ({ where }: { where: { userId: string } }) => {
        revokedUserIds.push(where.userId);
        return { count: 1 };
      },
    },
    classroom: {
      findUnique: async () => classroom ?? null,
      create: async ({ data }: { data: { id: string; managerId: string; name: string } }) => {
        classroom = data;
        return data;
      },
    },
    classroomMembership: {
      findFirst: async () => membership ?? null,
      create: async ({ data }: { data: { classroomId: string; studentId: string } }) => {
        membership = {
          id: "30000000-0000-4000-8000-000000000001",
          ...data,
        };
        return membership;
      },
    },
  });
  return { database, credentials, revokedUserIds };
}

const input = {
  teacherStaffNo: "T-01",
  teacherPassword: "teacher-password1",
  studentNo: "100001",
  studentPassword: "student-password1",
  teacherDisplayName: "验收教师",
  studentDisplayName: "验收学生",
  classroomId: "20000000-0000-4000-8000-000000000001",
  classroomName: "验收班级",
};

describe("local classroom bootstrap", () => {
  it("creates local credentials and repeats without returning passwords", async () => {
    const fixture = fixtureDatabase();
    const first = await bootstrapLocalClassroom(fixture.database as never, input, () => new Date("2026-09-01T00:00:00Z"));
    const repeated = await bootstrapLocalClassroom(
      fixture.database as never,
      { ...input, teacherPassword: "teacher-password2", studentPassword: "student-password2" },
      () => new Date("2026-09-01T00:00:00Z"),
    );

    expect(first.teacher.status).toBe("CREATED");
    expect(first.student.status).toBe("CREATED");
    expect(repeated.teacher).toEqual({ id: first.teacher.id, status: "EXISTING" });
    expect(repeated.student).toEqual({ id: first.student.id, status: "EXISTING" });
    expect(JSON.stringify(first)).not.toContain("password");
    expect(JSON.stringify(repeated)).not.toContain("hash:");
    expect([...fixture.credentials.values()].map((credential) => credential.passwordHash)).toEqual(
      expect.arrayContaining(["hash:teacher-password2", "hash:student-password2"]),
    );
    expect(fixture.revokedUserIds).toEqual([first.teacher.id, first.student.id]);
    expect(bootstrapLocalClassroomResultSchema.parse(repeated)).toEqual(repeated);
  });
});
