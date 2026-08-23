import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  bootstrapClerkClassroomInputSchema,
  bootstrapClerkClassroomResultSchema,
  BootstrapClerkClassroomError,
} from "./bootstrap-clerk-classroom";
import {
  BootstrapClerkCliConfigurationError,
  parseBootstrapClerkCliArguments,
  resolveBootstrapDatabaseTarget,
  serializeBootstrapClerkCliError,
  serializeBootstrapClerkCliSuccess,
} from "./bootstrap-clerk-cli";

const validArguments = [
  "--teacher-subject",
  "user_teacher123",
  "--teacher-name",
  "Teacher Lin",
  "--student-subject",
  "user_student123",
  "--student-name",
  "Student Chen",
  "--classroom-id",
  "10000000-0000-4000-8000-000000000001",
  "--classroom-name",
  "Class A",
  "--confirm-database",
  "cdas_next",
] as const;

describe("Clerk bootstrap CLI boundary", () => {
  it("parses only the explicit bootstrap contract", () => {
    expect(parseBootstrapClerkCliArguments(validArguments)).toEqual({
      kind: "run",
      confirmedDatabase: "cdas_next",
      input: {
        teacherAuthSubject: "user_teacher123",
        teacherDisplayName: "Teacher Lin",
        studentAuthSubject: "user_student123",
        studentDisplayName: "Student Chen",
        classroomId: "10000000-0000-4000-8000-000000000001",
        classroomName: "Class A",
      },
    });
    expect(parseBootstrapClerkCliArguments(["--help"])).toEqual({
      kind: "help",
    });
    expect(parseBootstrapClerkCliArguments(["--", "--help"])).toEqual({
      kind: "help",
    });
  });

  it("rejects unknown CLI options and widened service input", () => {
    expect(() =>
      parseBootstrapClerkCliArguments([
        ...validArguments,
        "--role",
        "TEACHER",
      ]),
    ).toThrow(TypeError);
    expect(() =>
      bootstrapClerkClassroomInputSchema.parse({
        teacherAuthSubject: "user_teacher123",
        teacherDisplayName: "Teacher Lin",
        studentAuthSubject: "user_student123",
        studentDisplayName: "Student Chen",
        classroomId: "10000000-0000-4000-8000-000000000001",
        classroomName: "Class A",
        role: "TEACHER",
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      bootstrapClerkClassroomResultSchema.parse({
        requestFingerprint: "a".repeat(64),
        teacher: {
          id: "10000000-0000-4000-8000-000000000001",
          status: "CREATED",
        },
        student: {
          id: "10000000-0000-4000-8000-000000000002",
          status: "CREATED",
        },
        classroom: {
          id: "10000000-0000-4000-8000-000000000003",
          status: "CREATED",
        },
        membership: {
          id: "10000000-0000-4000-8000-000000000004",
          status: "CREATED",
        },
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects one Clerk subject being assigned both roles", () => {
    expect(() =>
      parseBootstrapClerkCliArguments(
        validArguments.map((argument) =>
          argument === "user_student123" ? "user_teacher123" : argument,
        ),
      ),
    ).toThrow(z.ZodError);
  });

  it("requires an explicit runtime database confirmation", () => {
    expect(() =>
      resolveBootstrapDatabaseTarget(
        { databaseUrl: undefined },
        "cdas_next",
      ),
    ).toThrow(
      new BootstrapClerkCliConfigurationError("DATABASE_URL_REQUIRED"),
    );
    expect(() =>
      resolveBootstrapDatabaseTarget(
        {
          databaseUrl:
            "postgresql://operator:secret@db.example/cdas_next",
        },
        "wrong_database",
      ),
    ).toThrow(
      new BootstrapClerkCliConfigurationError(
        "DATABASE_CONFIRMATION_MISMATCH",
      ),
    );
  });

  it("refuses to connect DATABASE_URL to the configured test target", () => {
    expect(() =>
      resolveBootstrapDatabaseTarget(
        {
          databaseUrl:
            "postgresql://operator:runtime-secret@localhost:5432/cdas_next_test",
          testDatabaseUrl:
            "postgresql://postgres:test-secret@127.0.0.1/cdas_next_test?schema=public",
        },
        "cdas_next_test",
      ),
    ).toThrow(
      new BootstrapClerkCliConfigurationError(
        "TEST_DATABASE_TARGET_FORBIDDEN",
      ),
    );
  });

  it("returns the connection string without ever serializing it in errors", () => {
    const connectionString =
      "postgresql://operator:do-not-print@db.example:5432/cdas_next?sslmode=require";
    expect(
      resolveBootstrapDatabaseTarget(
        { databaseUrl: connectionString },
        "cdas_next",
      ),
    ).toEqual({
      connectionString,
      databaseName: "cdas_next",
      redactedTarget: "db.example:5432/cdas_next",
    });

    const serialized = serializeBootstrapClerkCliError(
      new BootstrapClerkClassroomError(
        "USER_ROLE_CONFLICT",
        "teacher",
      ),
    );
    expect(serialized).toContain("USER_ROLE_CONFLICT");
    expect(serialized).not.toContain("user_teacher123");
    expect(serialized).not.toContain("do-not-print");
  });

  it("uses DATABASE_URL while keeping TEST_DATABASE_URL non-connectable", () => {
    const runtimeUrl =
      "postgresql://runtime-user:runtime-secret@runtime.example:5432/cdas_next";
    const testUrl =
      "postgresql://test-user:test-secret@test.example:5432/cdas_next_test";

    const target = resolveBootstrapDatabaseTarget(
      { databaseUrl: runtimeUrl, testDatabaseUrl: testUrl },
      "cdas_next",
    );

    expect(target.connectionString).toBe(runtimeUrl);
    expect(target.connectionString).not.toBe(testUrl);
    expect(target.redactedTarget).toBe(
      "runtime.example:5432/cdas_next",
    );
    expect(JSON.stringify(target.redactedTarget)).not.toContain(
      "runtime-secret",
    );
    expect(JSON.stringify(target.redactedTarget)).not.toContain(
      "test-secret",
    );
  });

  it("serializes only a redacted target and internal resource results", () => {
    const teacherSubject = "user_teacherMustNotLeak";
    const studentSubject = "user_studentMustNotLeak";
    const target = resolveBootstrapDatabaseTarget(
      {
        databaseUrl:
          "postgresql://operator:must-not-leak@db.example:5432/cdas_next?sslmode=require",
      },
      "cdas_next",
    );
    const serialized = serializeBootstrapClerkCliSuccess(target, {
      teacher: {
        id: "10000000-0000-4000-8000-000000000001",
        status: "CREATED",
      },
      student: {
        id: "10000000-0000-4000-8000-000000000002",
        status: "CREATED",
      },
      classroom: {
        id: "10000000-0000-4000-8000-000000000003",
        status: "CREATED",
      },
      membership: {
        id: "10000000-0000-4000-8000-000000000004",
        status: "CREATED",
      },
    });

    expect(JSON.parse(serialized)).toEqual({
      ok: true,
      databaseTarget: "db.example:5432/cdas_next",
      resources: {
        teacher: {
          id: "10000000-0000-4000-8000-000000000001",
          status: "CREATED",
        },
        student: {
          id: "10000000-0000-4000-8000-000000000002",
          status: "CREATED",
        },
        classroom: {
          id: "10000000-0000-4000-8000-000000000003",
          status: "CREATED",
        },
        membership: {
          id: "10000000-0000-4000-8000-000000000004",
          status: "CREATED",
        },
      },
    });
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain(teacherSubject);
    expect(serialized).not.toContain(studentSubject);
    expect(serialized).not.toContain("requestFingerprint");
    expect(serialized).not.toContain("sslmode");
  });
});
