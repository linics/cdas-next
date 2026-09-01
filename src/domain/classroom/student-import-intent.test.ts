import { describe, expect, it } from "vitest";
import {
  hashStudentImportPayload,
  studentImportPayloadSchema,
} from "./student-import-intent";

const payload = {
  schemaVersion: 1 as const,
  classroomId: "11111111-1111-4111-8111-111111111111",
  classroomName: "八年级（3）班",
  expectedClassroomVersion: 3,
  entries: [
    { studentNo: "20260001", displayName: "张三" },
    { studentNo: "20260002", displayName: "李四" },
  ],
};

describe("student import intent", () => {
  it("hashes a payload independently of key order", () => {
    const reordered = {
      entries: payload.entries.map((entry) => ({
        displayName: entry.displayName,
        studentNo: entry.studentNo,
      })),
      expectedClassroomVersion: payload.expectedClassroomVersion,
      classroomName: payload.classroomName,
      classroomId: payload.classroomId,
      schemaVersion: 1 as const,
    };
    expect(hashStudentImportPayload(reordered)).toBe(hashStudentImportPayload(payload));
  });

  it("changes the hash when an entry changes", () => {
    const changed = {
      ...payload,
      entries: [payload.entries[0], { studentNo: "20260002", displayName: "李四改" }],
    };
    expect(hashStudentImportPayload(changed)).not.toBe(hashStudentImportPayload(payload));
  });

  it("rejects duplicate student numbers and unknown fields", () => {
    expect(() =>
      studentImportPayloadSchema.parse({
        ...payload,
        entries: [payload.entries[0], payload.entries[0]],
      }),
    ).toThrow();
    expect(() =>
      studentImportPayloadSchema.parse({ ...payload, extra: true }),
    ).toThrow();
  });
});
