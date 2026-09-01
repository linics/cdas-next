import type { PrismaClient } from "../../generated/prisma/client";
import type { StudentRosterEntry } from "../../domain/classroom/student-roster-xlsx";

type TransactionClient = Parameters<PrismaClient["$transaction"]>[0] extends (
  transaction: infer Value,
) => unknown
  ? Value
  : never;

export type ClassificationClient = Pick<
  TransactionClient,
  "appUser" | "classroomMembership"
>;

export type StudentImportRowStatus =
  /** No account with this student number exists in the school yet. */
  | "CREATE"
  /** An existing account of this school joins the classroom. */
  | "REUSE"
  /** Already a current member of this classroom; importing changes nothing. */
  | "ALREADY_CURRENT"
  | "CONFLICT_OTHER_CLASSROOM"
  | "CONFLICT_SCHEDULED"
  | "CONFLICT_NOT_STUDENT"
  | "CONFLICT_DISABLED";

export type ClassifiedImportRow = Readonly<{
  rowNumber: number;
  studentNo: string;
  displayName: string;
  status: StudentImportRowStatus;
  /** Set when an account already exists and its stored name differs from the file. */
  existingDisplayName?: string;
}>;

export const importableStatuses = ["CREATE", "REUSE"] as const;

export function isImportable(row: ClassifiedImportRow): boolean {
  return (importableStatuses as readonly string[]).includes(row.status);
}

/**
 * Decides, per row, what an import would do. Shared by the read-only preview
 * query and the prepare command so the teacher confirms exactly what the
 * command re-checks. Rows are classified against the school the classroom
 * belongs to; nothing here writes.
 */
export async function classifyStudentImportRows(
  client: ClassificationClient,
  input: Readonly<{
    schoolId: string;
    classroomId: string;
    now: Date;
    entries: readonly Readonly<{ rowNumber: number; entry: StudentRosterEntry }>[];
  }>,
): Promise<ClassifiedImportRow[]> {
  if (input.entries.length === 0) return [];
  const existing = await client.appUser.findMany({
    where: {
      schoolId: input.schoolId,
      studentNo: { in: input.entries.map((row) => row.entry.studentNo) },
    },
    select: {
      id: true,
      role: true,
      accountStatus: true,
      studentNo: true,
      displayName: true,
    },
  });
  const byStudentNo = new Map(
    existing.flatMap((user) => (user.studentNo ? [[user.studentNo, user] as const] : [])),
  );
  const memberships = existing.length
    ? await client.classroomMembership.findMany({
        where: {
          studentId: { in: existing.map((user) => user.id) },
          OR: [{ endedAt: null }, { endedAt: { gt: input.now } }],
        },
        select: { studentId: true, classroomId: true, joinedAt: true, endedAt: true },
      })
    : [];
  const currentHere = new Set(
    memberships
      .filter(
        (membership) =>
          membership.joinedAt <= input.now &&
          (membership.endedAt === null || membership.endedAt > input.now) &&
          membership.classroomId === input.classroomId,
      )
      .map((membership) => membership.studentId),
  );
  const currentElsewhere = new Set(
    memberships
      .filter(
        (membership) =>
          membership.joinedAt <= input.now &&
          (membership.endedAt === null || membership.endedAt > input.now) &&
          membership.classroomId !== input.classroomId,
      )
      .map((membership) => membership.studentId),
  );
  const scheduled = new Set(
    memberships
      .filter((membership) => membership.joinedAt > input.now)
      .map((membership) => membership.studentId),
  );

  return input.entries.map(({ rowNumber, entry }) => {
    const account = byStudentNo.get(entry.studentNo);
    const base = { rowNumber, studentNo: entry.studentNo, displayName: entry.displayName };
    if (!account) return { ...base, status: "CREATE" as const };
    // An existing account keeps its own name: a roster import may add members,
    // never rewrite another account's profile.
    const existingDisplayName =
      account.displayName === entry.displayName ? undefined : account.displayName;
    if (account.role !== "STUDENT") {
      return { ...base, status: "CONFLICT_NOT_STUDENT" as const };
    }
    if (account.accountStatus !== "ACTIVE") {
      return { ...base, status: "CONFLICT_DISABLED" as const, existingDisplayName };
    }
    if (currentHere.has(account.id)) {
      return { ...base, status: "ALREADY_CURRENT" as const, existingDisplayName };
    }
    if (currentElsewhere.has(account.id)) {
      return { ...base, status: "CONFLICT_OTHER_CLASSROOM" as const, existingDisplayName };
    }
    if (scheduled.has(account.id)) {
      return { ...base, status: "CONFLICT_SCHEDULED" as const, existingDisplayName };
    }
    return { ...base, status: "REUSE" as const, existingDisplayName };
  });
}
