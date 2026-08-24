import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  classroomMembershipPayloadSchema,
  hashClassroomMembershipPayload,
} from "./classroom-membership-intent";

describe("classroom membership intent payload", () => {
  it("hashes an exact normalized add change", () => {
    const payload = classroomMembershipPayloadSchema.parse({
      schemaVersion: 1,
      operation: "ADD",
      classroomId: randomUUID(),
      classroomName: "八年二班",
      expectedClassroomVersion: 3,
      students: [
        {
          studentId: randomUUID(),
          displayName: "陈同学",
          rosterKey: "student-8a01",
        },
      ],
    });
    expect(payload.operation).toBe("ADD");
    if (payload.operation !== "ADD") throw new Error("Expected add payload");
    expect(payload.students[0]?.rosterKey).toBe("STUDENT8A01");
    expect(hashClassroomMembershipPayload(payload)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("keeps end changes bound to one exact membership", () => {
    const payload = classroomMembershipPayloadSchema.parse({
      schemaVersion: 1,
      operation: "END",
      classroomId: randomUUID(),
      classroomName: "八年二班",
      expectedClassroomVersion: 4,
      membershipId: randomUUID(),
      student: { studentId: randomUUID(), displayName: "陈同学" },
    });
    expect(payload.operation).toBe("END");
  });
});
