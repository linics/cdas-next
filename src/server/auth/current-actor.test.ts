import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.fn();
const headerStore = new Map<string, string>();

vi.mock("@clerk/nextjs/server", () => ({
  auth: (...args: unknown[]) => auth(...args),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerStore.get(name) ?? null,
  }),
}));

import { AuthenticationError, getCurrentActor } from "./current-actor";

const teacher = {
  id: "teacher-row",
  authSubject: "user_teacher123",
  role: "TEACHER" as const,
  displayName: "林老师",
  accountStatus: "ACTIVE" as const,
  schoolId: "school-row",
  school: { status: "ACTIVE" as const },
};
const student = {
  id: "student-row",
  authSubject: "user_student123",
  role: "STUDENT" as const,
  displayName: "陈同学",
  accountStatus: "ACTIVE" as const,
  schoolId: "school-row",
  school: { status: "ACTIVE" as const },
};
const admin = {
  id: "admin-row",
  authSubject: "user_admin123",
  role: "ADMIN" as const,
  displayName: "平台管理员",
  accountStatus: "ACTIVE" as const,
  schoolId: null,
  school: null,
};

function databaseDouble(users = [teacher, student, admin]) {
  return {
    appUser: {
      findUnique: vi.fn(async ({ where }: { where: { authSubject: string } }) =>
        users.find((user) => user.authSubject === where.authSubject) ?? null,
      ),
    },
  };
}

describe("getCurrentActor clickthrough", () => {
  beforeEach(() => {
    headerStore.clear();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_TEST_TEACHER_CLERK_ID", teacher.authSubject);
    vi.stubEnv("DEV_TEST_STUDENT_CLERK_ID", student.authSubject);
    vi.stubEnv("DEV_TEST_ADMIN_CLERK_ID", admin.authSubject);
    vi.stubEnv("VERCEL_ENV", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("enters teacher, student, and admin workspaces without Clerk by default", async () => {
    headerStore.set("x-cdas-pathname", "/teacher");
    await expect(
      getCurrentActor(databaseDouble() as never),
    ).resolves.toMatchObject(teacher);

    headerStore.set("x-cdas-pathname", "/student");
    await expect(
      getCurrentActor(databaseDouble() as never),
    ).resolves.toMatchObject(student);

    headerStore.set("x-cdas-pathname", "/admin");
    await expect(
      getCurrentActor(databaseDouble() as never),
    ).resolves.toMatchObject(admin);
    expect(auth).not.toHaveBeenCalled();
  });

  it("uses Clerk when clickthrough is explicitly turned off", async () => {
    vi.stubEnv("DEV_CLICKTHROUGH_AUTH", "0");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
    headerStore.set("x-cdas-pathname", "/teacher");
    auth.mockResolvedValue({ userId: teacher.authSubject });

    await expect(
      getCurrentActor(databaseDouble() as never),
    ).resolves.toMatchObject(teacher);
    expect(auth).toHaveBeenCalled();
  });

  it("rejects unknown paths instead of inventing an actor", async () => {
    headerStore.set("x-cdas-pathname", "/");
    await expect(getCurrentActor(databaseDouble() as never)).rejects.toMatchObject(
      { code: "UNAUTHENTICATED" } satisfies Pick<AuthenticationError, "code">,
    );
    expect(auth).not.toHaveBeenCalled();
  });
});
