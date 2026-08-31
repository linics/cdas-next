import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class StudentImportError extends Error {
    constructor(
      public readonly code:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "IDEMPOTENCY_MISMATCH"
        | "ACTION_NOT_CONFIRMED"
        | "ACTION_EXPIRED"
        | "INTENT_TAMPERED"
        | "CLASSROOM_CHANGED"
        | "STUDENT_IN_OTHER_CLASSROOM"
        | "STUDENT_CONFLICT"
        | "CONCURRENT_WRITE",
    ) {
      super(code);
      this.name = "StudentImportError";
    }
  }

  return {
    decideActionIntent: vi.fn(),
    executeStudentImport: vi.fn(),
    getDatabaseClient: vi.fn(() => ({})),
    revalidatePath: vi.fn(),
    StudentImportError,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: async () => ({
    actorId: "123e4567-e89b-12d3-a456-426614174001",
    source: "UI",
    traceId: "test-trace",
    clock: () => new Date("2026-08-31T00:00:00.000Z"),
  }),
}));
vi.mock("../../../../../server/commands/decide-action-intent", () => ({
  decideActionIntent: mocks.decideActionIntent,
  DecideActionIntentError: class DecideActionIntentError extends Error {},
}));
vi.mock("../../../../../server/commands/student-import", () => ({
  executeStudentImport: mocks.executeStudentImport,
  prepareStudentImport: vi.fn(),
  StudentImportError: mocks.StudentImportError,
}));
vi.mock("../../../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));

import { decideStudentImportAction } from "./actions";

describe("student import decision action", () => {
  it("tells the teacher when the confirmation window has expired", async () => {
    mocks.decideActionIntent.mockResolvedValueOnce(undefined);
    mocks.executeStudentImport.mockRejectedValueOnce(
      new mocks.StudentImportError("ACTION_EXPIRED"),
    );

    await expect(
      decideStudentImportAction({
        actionIntentId: "123e4567-e89b-12d3-a456-426614174000",
        decision: "CONFIRM",
        idempotencyKey: "apply-12345678",
      }),
    ).resolves.toEqual({
      ok: false,
      code: "CONFLICT",
      message: "本次导入确认已过期，请重新选择 Excel 文件并预览。",
    });
  });
});
