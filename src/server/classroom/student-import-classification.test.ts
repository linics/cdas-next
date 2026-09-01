import { describe, expect, it } from "vitest";
import {
  classifyStudentImportRows,
  type ClassificationClient,
} from "./student-import-classification";

const classroomId = "11111111-1111-4111-8111-111111111111";
const otherClassroomId = "22222222-2222-4222-8222-222222222222";
const schoolId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-09-01T00:00:00.000Z");

type Account = {
  id: string;
  role: "TEACHER" | "STUDENT";
  accountStatus: "ACTIVE" | "DISABLED";
  studentNo: string;
  displayName: string;
};

function client(
  accounts: readonly Account[],
  memberships: readonly {
    studentId: string;
    classroomId: string;
    joinedAt?: Date;
    endedAt?: Date | null;
  }[],
): ClassificationClient {
  return {
    appUser: { findMany: async () => accounts },
    classroomMembership: {
      findMany: async () => memberships.map((membership) => ({
        joinedAt: new Date("2026-08-01T00:00:00.000Z"),
        endedAt: null,
        ...membership,
      })),
    },
  } as unknown as ClassificationClient;
}

function rows(...entries: readonly { studentNo: string; displayName: string }[]) {
  return entries.map((entry, index) => ({ rowNumber: index + 2, entry }));
}

describe("classifyStudentImportRows", () => {
  it("marks a student number without an account as CREATE", async () => {
    const result = await classifyStudentImportRows(client([], []), {
      schoolId,
      classroomId,
      now,
      entries: rows({ studentNo: "20260001", displayName: "张三" }),
    });
    expect(result).toEqual([
      { rowNumber: 2, studentNo: "20260001", displayName: "张三", status: "CREATE" },
    ]);
  });

  it("reuses an existing account and keeps its stored name", async () => {
    const result = await classifyStudentImportRows(
      client(
        [{ id: "a", role: "STUDENT", accountStatus: "ACTIVE", studentNo: "20260001", displayName: "张三" }],
        [],
      ),
      {
        schoolId,
        classroomId,
        now,
        entries: rows({ studentNo: "20260001", displayName: "张 三" }),
      },
    );
    expect(result[0]).toMatchObject({ status: "REUSE", existingDisplayName: "张三" });
  });

  it("separates members of this classroom from members of another one", async () => {
    const result = await classifyStudentImportRows(
      client(
        [
          { id: "a", role: "STUDENT", accountStatus: "ACTIVE", studentNo: "20260001", displayName: "张三" },
          { id: "b", role: "STUDENT", accountStatus: "ACTIVE", studentNo: "20260002", displayName: "李四" },
        ],
        [
          { studentId: "a", classroomId },
          { studentId: "b", classroomId: otherClassroomId },
        ],
      ),
      {
        schoolId,
        classroomId,
        now,
        entries: rows(
          { studentNo: "20260001", displayName: "张三" },
          { studentNo: "20260002", displayName: "李四" },
        ),
      },
    );
    expect(result.map((row) => row.status)).toEqual([
      "ALREADY_CURRENT",
      "CONFLICT_OTHER_CLASSROOM",
    ]);
  });

  it("refuses a student number that belongs to a teacher or a disabled account", async () => {
    const result = await classifyStudentImportRows(
      client(
        [
          { id: "a", role: "TEACHER", accountStatus: "ACTIVE", studentNo: "20260001", displayName: "王老师" },
          { id: "b", role: "STUDENT", accountStatus: "DISABLED", studentNo: "20260002", displayName: "李四" },
        ],
        [],
      ),
      {
        schoolId,
        classroomId,
        now,
        entries: rows(
          { studentNo: "20260001", displayName: "张三" },
          { studentNo: "20260002", displayName: "李四" },
        ),
      },
    );
    expect(result.map((row) => row.status)).toEqual([
      "CONFLICT_NOT_STUDENT",
      "CONFLICT_DISABLED",
    ]);
  });

  it("reports a future membership as a scheduled conflict, not a current member", async () => {
    const result = await classifyStudentImportRows(
      client(
        [{ id: "a", role: "STUDENT", accountStatus: "ACTIVE", studentNo: "20260001", displayName: "张三" }],
        [{
          studentId: "a",
          classroomId,
          joinedAt: new Date("2026-09-02T00:00:00.000Z"),
          endedAt: null,
        }],
      ),
      {
        schoolId,
        classroomId,
        now,
        entries: rows({ studentNo: "20260001", displayName: "张三" }),
      },
    );
    expect(result[0]).toMatchObject({ status: "CONFLICT_SCHEDULED" });
  });
});
