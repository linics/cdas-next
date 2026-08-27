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
};
const student = {
  id: "student-row",
  authSubject: "user_student123",
  role: "STUDENT" as const,
  displayName: "陈同学",
};

function databaseDouble(users = [teacher, student]) {
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
    vi.stubEnv("DEV_CLICKTHROUGH_AUTH", "1");
    vi.stubEnv("DEV_TEST_TEACHER_CLERK_ID", teacher.authSubject);
    vi.stubEnv("DEV_TEST_STUDENT_CLERK_ID", student.authSubject);
    vi.stubEnv("VERCEL_ENV", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("enters the teacher workspace as the preconfigured teacher without Clerk", async () => {
    headerStore.set("x-cdas-pathname", "/teacher");
    const database = databaseDouble();

    await expect(
      getCurrentActor(database as never),
    ).resolves.toMatchObject(teacher);
    expect(auth).not.toHaveBeenCalled();
  });

  it("enters the student workspace as the preconfigured student without Clerk", async () => {
    headerStore.set("x-cdas-pathname", "/student/releases/r1");
    const database = databaseDouble();

    await expect(
      getCurrentActor(database as never),
    ).resolves.toMatchObject(student);
    expect(auth).not.toHaveBeenCalled();
  });

  it("does not use clickthrough outside local development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_example");
    headerStore.set("x-cdas-pathname", "/teacher");
    auth.mockResolvedValue({ userId: teacher.authSubject });
    const database = databaseDouble();

    await expect(
      getCurrentActor(database as never),
    ).resolves.toMatchObject(teacher);
    expect(auth).toHaveBeenCalled();
  });

  it("rejects unknown paths instead of inventing an actor", async () => {
    headerStore.set("x-cdas-pathname", "/");
    const database = databaseDouble();

    await expect(getCurrentActor(database as never)).rejects.toEqual(
      new AuthenticationError("UNAUTHENTICATED"),
    );
    expect(auth).not.toHaveBeenCalled();
  });
});
