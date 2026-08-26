import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { rosterKeySchema } from "./roster-key";

const studentIdentitySchema = z
  .object({
    studentId: z.uuid(),
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();

const studentRosterSnapshotSchema = studentIdentitySchema.extend({
  rosterKey: rosterKeySchema,
});

const baseSchema = z.object({
  schemaVersion: z.literal(1),
  classroomId: z.uuid(),
  classroomName: z.string().trim().min(1).max(120),
  expectedClassroomVersion: z.int().positive(),
});

export const addClassroomMembersPayloadSchema = baseSchema
  .extend({
    operation: z.literal("ADD"),
    students: z.array(studentRosterSnapshotSchema).min(1).max(50),
  })
  .strict();

export const endClassroomMembershipPayloadSchema = baseSchema
  .extend({
    operation: z.literal("END"),
    membershipId: z.uuid(),
    student: studentIdentitySchema,
  })
  .strict();

export const classroomMembershipPayloadSchema = z.discriminatedUnion(
  "operation",
  [addClassroomMembersPayloadSchema, endClassroomMembershipPayloadSchema],
);

export type ClassroomMembershipPayload = z.infer<
  typeof classroomMembershipPayloadSchema
>;

export function hashClassroomMembershipPayload(
  payload: ClassroomMembershipPayload,
): string {
  const parsed = classroomMembershipPayloadSchema.parse(payload);
  const value = canonicalize(parsed);
  if (value === undefined) {
    throw new TypeError("Classroom membership payload cannot be canonicalized");
  }
  return createHash("sha256").update(value).digest("hex");
}
