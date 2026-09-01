import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { studentRosterEntriesSchema } from "./student-roster-xlsx";

export const studentImportPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    classroomId: z.uuid(),
    classroomName: z.string().trim().min(1).max(120),
    expectedClassroomVersion: z.int().positive(),
    /** Only the rows the teacher may actually import; conflicts never enter the payload. */
    entries: studentRosterEntriesSchema,
  })
  .strict();

export type StudentImportPayload = z.infer<typeof studentImportPayloadSchema>;

export function hashStudentImportPayload(payload: StudentImportPayload): string {
  const parsed = studentImportPayloadSchema.parse(payload);
  const value = canonicalize(parsed);
  if (value === undefined) {
    throw new TypeError("Student import payload cannot be canonicalized");
  }
  return createHash("sha256").update(value).digest("hex");
}
