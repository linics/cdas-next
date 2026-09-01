import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "student-import-action-database" },
  context: {
    actorId: "11111111-1111-4111-8111-111111111111",
    source: "UI" as const,
    traceId: "student-import-action-trace",
    clock: () => new Date("2026-09-01T00:00:00.000Z"),
  },
  createUiCommandContext: vi.fn(),
  getDatabaseClient: vi.fn(),
  parseStudentRosterWorkbook: vi.fn(),
  previewStudentImport: vi.fn(),
  prepareStudentImport: vi.fn(),
  executeStudentImport: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));
vi.mock("../../../../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createUiCommandContext,
}));
vi.mock("../../../../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AuthenticationError";
    }
  },
}));
vi.mock(
  "../../../../../domain/classroom/student-roster-xlsx",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../../../../domain/classroom/student-roster-xlsx")
    >();
    return { ...actual, parseStudentRosterWorkbook: mocks.parseStudentRosterWorkbook };
  },
);
vi.mock("../../../../../server/queries/teacher-classroom-roster", () => ({
  previewStudentImport: mocks.previewStudentImport,
  previewTeacherRosterImport: vi.fn(),
  TeacherClassroomRosterQueryError: class TeacherClassroomRosterQueryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "TeacherClassroomRosterQueryError";
    }
  },
}));
vi.mock("../../../../../server/commands/student-import", () => ({
  prepareStudentImport: mocks.prepareStudentImport,
  executeStudentImport: mocks.executeStudentImport,
  StudentImportError: class StudentImportError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "StudentImportError";
    }
  },
}));
vi.mock("../../../../../server/commands/apply-classroom-membership-change", () => ({
  applyClassroomMembershipChange: vi.fn(),
  ApplyClassroomMembershipChangeError: class ApplyClassroomMembershipChangeError extends Error {},
}));
vi.mock("../../../../../server/commands/prepare-classroom-membership-change", () => ({
  prepareClassroomMembershipChange: vi.fn(),
  PrepareClassroomMembershipChangeError: class PrepareClassroomMembershipChangeError extends Error {},
}));
vi.mock("../../../../../server/commands/decide-action-intent", () => ({
  decideActionIntent: vi.fn(),
  DecideActionIntentError: class DecideActionIntentError extends Error {},
}));

import { AuthenticationError } from "../../../../../server/auth/current-actor";
import { TeacherClassroomRosterQueryError } from "../../../../../server/queries/teacher-classroom-roster";
import * as actions from "./actions";

const classroomId = "22222222-2222-4222-8222-222222222222";

function upload(): FormData {
  const data = new FormData();
  data.set("classroomId", classroomId);
  data.set("idempotencyKey", "prepare_student_import_test_001");
  data.set(
    "file",
    new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "roster.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  return data;
}

describe("student roster upload server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUiCommandContext.mockResolvedValue(mocks.context);
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.previewStudentImport
      .mockResolvedValueOnce({
        classroom: { id: classroomId, name: "八年级一班", version: 1 },
        rows: [],
      })
      .mockResolvedValueOnce({
        classroom: { id: classroomId, name: "八年级一班", version: 1 },
        rows: [{
          rowNumber: 2,
          studentNo: "20260001",
          displayName: "张三",
          status: "CREATE",
        }],
      });
    mocks.parseStudentRosterWorkbook.mockReturnValue([
      {
        rowNumber: 2,
        ok: true,
        entry: { studentNo: "20260001", displayName: "张三" },
      },
    ]);
    mocks.prepareStudentImport.mockResolvedValue({
      actionIntentId: "33333333-3333-4333-8333-333333333333",
      classroomId,
      classroomName: "八年级一班",
      expectedClassroomVersion: 1,
      entries: [{ studentNo: "20260001", displayName: "张三", status: "CREATE" }],
      payloadHash: "a".repeat(64),
      expiresAt: "2026-09-01T00:10:00.000Z",
    });
  });

  it("authenticates and authorizes the managed classroom before parsing XLSX bytes", async () => {
    const result = await actions.previewStudentImportAction(upload());

    expect(result).toMatchObject({ ok: true, importable: [{ studentNo: "20260001" }] });
    expect(mocks.previewStudentImport).toHaveBeenNthCalledWith(
      1,
      mocks.database,
      mocks.context,
      { classroomId, rows: [] },
    );
    expect(mocks.previewStudentImport.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.parseStudentRosterWorkbook.mock.invocationCallOrder[0]!,
    );
    expect(mocks.prepareStudentImport).toHaveBeenCalledWith(
      mocks.database,
      mocks.context,
      {
        classroomId,
        entries: [{ studentNo: "20260001", displayName: "张三" }],
        idempotencyKey: "prepare_student_import_test_001",
      },
    );
  });

  it("does not parse when authentication is unavailable", async () => {
    mocks.createUiCommandContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const result = await actions.previewStudentImportAction(upload());

    expect(result).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(mocks.previewStudentImport).not.toHaveBeenCalled();
    expect(mocks.parseStudentRosterWorkbook).not.toHaveBeenCalled();
    expect(mocks.prepareStudentImport).not.toHaveBeenCalled();
  });

  it("does not parse when the teacher does not manage the classroom", async () => {
    mocks.previewStudentImport.mockReset().mockRejectedValue(
      new TeacherClassroomRosterQueryError("NOT_FOUND"),
    );

    const result = await actions.previewStudentImportAction(upload());

    expect(result).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(mocks.parseStudentRosterWorkbook).not.toHaveBeenCalled();
    expect(mocks.prepareStudentImport).not.toHaveBeenCalled();
  });

  it("exposes no separate client-callable prepare action", () => {
    expect(actions).not.toHaveProperty("prepareStudentImportAction");
  });
});
