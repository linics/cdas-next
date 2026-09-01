import "server-only";

import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import {
  hashStudentImportPayload,
  type StudentImportPayload,
  studentImportPayloadSchema,
} from "../../domain/classroom/student-import-intent";
import {
  MAX_ROSTER_IMPORT_ROWS,
  studentRosterEntriesSchema,
  type StudentRosterEntry,
} from "../../domain/classroom/student-roster-xlsx";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  hashPassword,
  initialStudentPassword,
  studentIdentifier,
} from "../auth/local-auth-primitives";
import {
  classifyStudentImportRows,
  type ClassificationClient,
} from "../classroom/student-import-classification";
import {
  assertActiveBusinessActor,
  SchoolMemberAuthorizationError,
} from "../school/teacher-authorization";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";
import {
  isRetryableSerializationError,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";

const prepareInputSchema = z
  .object({
    classroomId: z.uuid(),
    entries: studentRosterEntriesSchema,
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const executeInputSchema = z
  .object({
    actionIntentId: z.uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

const prepareResultSchema = z
  .object({
    actionIntentId: z.uuid(),
    classroomId: z.uuid(),
    classroomName: z.string().trim().min(1),
    expectedClassroomVersion: z.int().positive(),
    entries: z
      .array(
        z
          .object({
            studentNo: z.string().regex(/^[0-9]{6,32}$/u),
            displayName: z.string().trim().min(1).max(120),
            status: z.enum(["CREATE", "REUSE"]),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_ROSTER_IMPORT_ROWS),
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/u),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const executeResultSchema = z
  .object({
    classroomId: z.uuid(),
    createdStudents: z.int().nonnegative(),
    reusedStudents: z.int().nonnegative(),
    joinedStudents: z.int().nonnegative(),
    skippedCurrentMembers: z.int().nonnegative(),
  })
  .strict();

export type PrepareStudentImportInput = z.input<typeof prepareInputSchema>;
export type PrepareStudentImportResult = z.infer<typeof prepareResultSchema>;
export type ExecuteStudentImportInput = z.input<typeof executeInputSchema>;
export type ExecuteStudentImportResult = z.infer<typeof executeResultSchema>;

export class StudentImportError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "ACCOUNT_DISABLED"
      | "SCHOOL_DISABLED"
      | "PREVIEW_STALE"
      | "CLASSROOM_CHANGED"
      | "ACTION_NOT_CONFIRMED"
      | "ACTION_EXPIRED"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "StudentImportError";
  }
}

const prepareCommandName = "prepare_student_import";
const executeCommandName = "execute_student_import";
const actionName = "import_students_to_classroom";
const intentLifetimeMilliseconds = 10 * 60 * 1_000;

type Transaction = Parameters<PrismaClient["$transaction"]>[0] extends (
  transaction: infer Value,
) => unknown
  ? Value
  : never;

function hashValue(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) {
    throw new TypeError("Student import input cannot be canonicalized");
  }
  return createHash("sha256").update(canonicalValue).digest("hex");
}

function sortEntries(
  entries: readonly StudentRosterEntry[],
): StudentRosterEntry[] {
  return [...entries].sort((left, right) =>
    left.studentNo.localeCompare(right.studentNo),
  );
}

function toDomainError(error: unknown): StudentImportError | null {
  if (error instanceof StudentImportError) return error;
  if (error instanceof SchoolMemberAuthorizationError) {
    return new StudentImportError(error.code);
  }
  return null;
}

async function requireManagedClassroom(
  transaction: Pick<Transaction, "appUser" | "classroom">,
  actorId: string,
  classroomId: string,
) {
  const [actor, classroom] = await Promise.all([
    transaction.appUser.findUnique({
      where: { id: actorId },
      select: {
        role: true,
        accountStatus: true,
        schoolId: true,
        school: { select: { status: true, code: true } },
      },
    }),
    transaction.classroom.findUnique({
      where: { id: classroomId },
      select: {
        id: true,
        name: true,
        version: true,
        managerId: true,
        schoolId: true,
      },
    }),
  ]);
  if (!actor) throw new StudentImportError("NOT_FOUND");
  assertActiveBusinessActor(actor);
  if (actor.role !== "TEACHER" || !actor.schoolId || !actor.school) {
    throw new StudentImportError("FORBIDDEN");
  }
  if (
    !classroom ||
    classroom.managerId !== actorId ||
    classroom.schoolId !== actor.schoolId
  ) {
    throw new StudentImportError("NOT_FOUND");
  }
  return {
    schoolId: actor.schoolId,
    schoolCode: actor.school.code,
    classroom,
  };
}

async function recordFailureAudit(
  database: PrismaClient,
  context: ResolvedCommandContext,
  commandName: string,
  targetId: string,
  requestHash: string,
  idempotencyKey: string,
  error: StudentImportError,
): Promise<void> {
  try {
    await database.actionAudit.create({
      data: {
        actorId: context.actorId,
        source: context.source,
        actionName: commandName,
        targetType: "Classroom",
        targetId,
        requestHash,
        idempotencyKey,
        outcome: ["FORBIDDEN", "NOT_FOUND", "ACCOUNT_DISABLED", "SCHOOL_DISABLED"].includes(
          error.code,
        )
          ? "DENIED"
          : "CONFLICTED",
        errorCode: error.code,
        traceId: context.traceId,
      },
    });
  } catch {
    console.error("Failed to record student-import failure audit", {
      command: commandName,
      errorCode: error.code,
      traceId: context.traceId,
    });
  }
}

async function runPrepareTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof prepareInputSchema>,
  requestHash: string,
): Promise<PrepareStudentImportResult> {
  return database.$transaction(
    async (transaction) => {
      const existingRecord = await transaction.idempotencyRecord.findUnique({
        where: {
          actorId_commandName_idempotencyKey: {
            actorId: context.actorId,
            commandName: prepareCommandName,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existingRecord) {
        if (existingRecord.requestHash !== requestHash) {
          throw new StudentImportError("IDEMPOTENCY_MISMATCH");
        }
        return prepareResultSchema.parse(existingRecord.response);
      }

      const { schoolId, classroom } = await requireManagedClassroom(
        transaction,
        context.actorId,
        input.classroomId,
      );
      const rows = await classifyStudentImportRows(
        transaction as ClassificationClient,
        {
          schoolId,
          classroomId: classroom.id,
          now: context.now,
          entries: input.entries.map((entry, index) => ({
            rowNumber: index + 1,
            entry,
          })),
        },
      );
      // The teacher confirms the set they previewed. If anything moved in
      // between, the whole preparation fails with zero writes instead of
      // silently importing a different set.
      if (rows.some((row) => row.status !== "CREATE" && row.status !== "REUSE")) {
        throw new StudentImportError("PREVIEW_STALE");
      }

      const payload: StudentImportPayload = studentImportPayloadSchema.parse({
        schemaVersion: 1,
        classroomId: classroom.id,
        classroomName: classroom.name,
        expectedClassroomVersion: classroom.version,
        entries: input.entries,
      });
      const payloadHash = hashStudentImportPayload(payload);
      const expiresAt = new Date(
        context.now.getTime() + intentLifetimeMilliseconds,
      );
      const intent = await transaction.actionIntent.create({
        data: {
          actorId: context.actorId,
          actionName,
          payload,
          payloadHash,
          targetType: "Classroom",
          targetId: classroom.id,
          expectedVersion: classroom.version,
          expiresAt,
          createdAt: context.now,
        },
        select: { id: true },
      });
      const response = prepareResultSchema.parse({
        actionIntentId: intent.id,
        classroomId: classroom.id,
        classroomName: classroom.name,
        expectedClassroomVersion: classroom.version,
        entries: rows.map((row) => ({
          studentNo: row.studentNo,
          displayName: row.displayName,
          status: row.status as "CREATE" | "REUSE",
        })),
        payloadHash,
        expiresAt: expiresAt.toISOString(),
      });

      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          actionIntentId: intent.id,
          source: context.source,
          actionName: prepareCommandName,
          targetType: "Classroom",
          targetId: classroom.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: classroom.version,
          afterVersion: classroom.version,
          resultResourceId: intent.id,
          traceId: context.traceId,
        },
      });
      await transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName: prepareCommandName,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          response,
          resourceType: "ActionIntent",
          resourceId: intent.id,
        },
      });
      return response;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}

/**
 * Turns a previewed roster file into a confirmable action intent. Only rows the
 * teacher may actually import enter the payload; conflicting rows must be
 * removed from the file before the teacher gets here.
 */
export async function prepareStudentImport(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: PrepareStudentImportInput,
): Promise<PrepareStudentImportResult> {
  const parsed = prepareInputSchema.parse(rawInput);
  const input = { ...parsed, entries: sortEntries(parsed.entries) };
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({
    source: context.source,
    classroomId: input.classroomId,
    entries: input.entries,
  });
  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try {
      return await runPrepareTransaction(database, context, input, requestHash);
    } catch (error) {
      const retryable = isRetryableSerializationError(error);
      if (retryable && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      const domainError =
        toDomainError(error) ??
        (retryable ? new StudentImportError("CONCURRENT_WRITE") : null);
      if (domainError) {
        await recordFailureAudit(
          database,
          context,
          prepareCommandName,
          input.classroomId,
          requestHash,
          input.idempotencyKey,
          domainError,
        );
        throw domainError;
      }
      throw error;
    }
  }
  throw new StudentImportError("CONCURRENT_WRITE");
}

/**
 * Argon2id is deliberately expensive, so initial passwords are derived before
 * the transaction opens. Only student numbers without an account are hashed.
 */
async function hashInitialPasswords(
  database: PrismaClient,
  schoolId: string,
  entries: readonly StudentRosterEntry[],
): Promise<Map<string, string>> {
  const existing = await database.appUser.findMany({
    where: { schoolId, studentNo: { in: entries.map((entry) => entry.studentNo) } },
    select: { studentNo: true },
  });
  const known = new Set(existing.flatMap((user) => (user.studentNo ? [user.studentNo] : [])));
  const hashes = new Map<string, string>();
  for (const entry of entries) {
    if (known.has(entry.studentNo)) continue;
    hashes.set(
      entry.studentNo,
      await hashPassword(initialStudentPassword(entry.studentNo)),
    );
  }
  return hashes;
}

async function runExecuteTransaction(
  database: PrismaClient,
  context: ResolvedCommandContext,
  input: z.infer<typeof executeInputSchema>,
  payload: StudentImportPayload,
  payloadHash: string,
  requestHash: string,
  passwordHashes: ReadonlyMap<string, string>,
): Promise<ExecuteStudentImportResult> {
  return database.$transaction(
    async (transaction) => {
      const existingRecord = await transaction.idempotencyRecord.findUnique({
        where: {
          actorId_commandName_idempotencyKey: {
            actorId: context.actorId,
            commandName: executeCommandName,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existingRecord) {
        if (existingRecord.requestHash !== requestHash) {
          throw new StudentImportError("IDEMPOTENCY_MISMATCH");
        }
        return executeResultSchema.parse(existingRecord.response);
      }

      const { schoolId, schoolCode, classroom } = await requireManagedClassroom(
        transaction,
        context.actorId,
        payload.classroomId,
      );
      const intent = await transaction.actionIntent.findUnique({
        where: { id: input.actionIntentId },
        select: {
          actorId: true,
          decidedById: true,
          actionName: true,
          targetType: true,
          targetId: true,
          status: true,
          expiresAt: true,
          payloadHash: true,
        },
      });
      if (
        !intent ||
        intent.actorId !== context.actorId ||
        intent.actionName !== actionName ||
        intent.targetType !== "Classroom" ||
        intent.targetId !== classroom.id ||
        intent.payloadHash !== payloadHash
      ) {
        throw new StudentImportError("NOT_FOUND");
      }
      if (intent.expiresAt <= context.now) {
        throw new StudentImportError("ACTION_EXPIRED");
      }
      if (intent.status !== "CONFIRMED" || intent.decidedById !== context.actorId) {
        throw new StudentImportError("ACTION_NOT_CONFIRMED");
      }
      if (classroom.version !== payload.expectedClassroomVersion) {
        throw new StudentImportError("CLASSROOM_CHANGED");
      }

      const rows = await classifyStudentImportRows(
        transaction as ClassificationClient,
        {
          schoolId,
          classroomId: classroom.id,
          now: context.now,
          entries: payload.entries.map((entry, index) => ({
            rowNumber: index + 1,
            entry,
          })),
        },
      );
      if (
        rows.some(
          (row) =>
            row.status !== "CREATE" &&
            row.status !== "REUSE" &&
            row.status !== "ALREADY_CURRENT",
        )
      ) {
        throw new StudentImportError("CLASSROOM_CHANGED");
      }

      let createdStudents = 0;
      let reusedStudents = 0;
      let skippedCurrentMembers = 0;
      const joiningStudentIds: string[] = [];
      for (const row of rows) {
        if (row.status === "ALREADY_CURRENT") {
          skippedCurrentMembers += 1;
          continue;
        }
        if (row.status === "REUSE") {
          const account = await transaction.appUser.findUnique({
            where: {
              schoolId_studentNo: { schoolId, studentNo: row.studentNo },
            },
            select: { id: true },
          });
          if (!account) throw new StudentImportError("CONCURRENT_WRITE");
          reusedStudents += 1;
          joiningStudentIds.push(account.id);
          continue;
        }
        const passwordHash = passwordHashes.get(row.studentNo);
        if (!passwordHash) throw new StudentImportError("CONCURRENT_WRITE");
        const studentId = randomUUID();
        await transaction.appUser.create({
          data: {
            id: studentId,
            authSubject: `local:${studentId}`,
            role: "STUDENT",
            displayName: row.displayName,
            schoolId,
            studentNo: row.studentNo,
            accountStatus: "ACTIVE",
            legacyProfile: false,
            createdAt: context.now,
            updatedAt: context.now,
          },
        });
        await transaction.localCredential.create({
          data: {
            userId: studentId,
            identifier: studentIdentifier(schoolCode, row.studentNo),
            passwordHash,
            // The derived initial password only survives the first sign-in.
            mustChangePassword: true,
          },
        });
        createdStudents += 1;
        joiningStudentIds.push(studentId);
      }

      if (joiningStudentIds.length > 0) {
        await transaction.classroomMembership.createMany({
          data: joiningStudentIds.map((studentId) => ({
            classroomId: classroom.id,
            studentId,
            joinedAt: context.now,
          })),
        });
        await transaction.classroom.update({
          where: { id: classroom.id },
          data: { version: { increment: 1 } },
        });
      }

      const response = executeResultSchema.parse({
        classroomId: classroom.id,
        createdStudents,
        reusedStudents,
        joinedStudents: joiningStudentIds.length,
        skippedCurrentMembers,
      });
      await transaction.actionIntent.update({
        where: { id: input.actionIntentId },
        data: { status: "EXECUTED", executedAt: context.now },
      });
      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          actionIntentId: input.actionIntentId,
          source: context.source,
          actionName: executeCommandName,
          targetType: "Classroom",
          targetId: classroom.id,
          requestHash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          beforeVersion: classroom.version,
          afterVersion:
            joiningStudentIds.length > 0 ? classroom.version + 1 : classroom.version,
          resultResourceId: classroom.id,
          traceId: context.traceId,
        },
      });
      await transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName: executeCommandName,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          response,
          resourceType: "Classroom",
          resourceId: classroom.id,
        },
      });
      return response;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    },
  );
}

/**
 * Creates the missing accounts and classroom memberships a confirmed intent
 * describes. Accounts that already exist keep their own profile and password;
 * students already in this classroom are skipped, never duplicated.
 */
export async function executeStudentImport(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: ExecuteStudentImportInput,
): Promise<ExecuteStudentImportResult> {
  const input = executeInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const intent = await database.actionIntent.findUnique({
    where: { id: input.actionIntentId },
    select: {
      actorId: true,
      actionName: true,
      payload: true,
      payloadHash: true,
      status: true,
      decidedById: true,
      expiresAt: true,
    },
  });
  if (
    !intent ||
    intent.actorId !== context.actorId ||
    intent.actionName !== actionName
  ) {
    throw new StudentImportError("NOT_FOUND");
  }
  const payload = studentImportPayloadSchema.parse(intent.payload);
  const payloadHash = hashStudentImportPayload(payload);
  if (intent.payloadHash !== payloadHash) {
    throw new StudentImportError("NOT_FOUND");
  }
  const requestHash = hashValue({
    source: context.source,
    actionIntentId: input.actionIntentId,
    payloadHash,
  });

  // A committed idempotency result is authoritative history. Replay it before
  // current authorization or Argon2 work; the transaction repeats this check
  // to close the race between concurrent first executions.
  const existingRecord = await database.idempotencyRecord.findUnique({
    where: {
      actorId_commandName_idempotencyKey: {
        actorId: context.actorId,
        commandName: executeCommandName,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existingRecord) {
    if (existingRecord.requestHash !== requestHash) {
      throw new StudentImportError("IDEMPOTENCY_MISMATCH");
    }
    return executeResultSchema.parse(existingRecord.response);
  }
  if (intent.expiresAt <= context.now) {
    throw new StudentImportError("ACTION_EXPIRED");
  }
  if (intent.status !== "CONFIRMED" || intent.decidedById !== context.actorId) {
    throw new StudentImportError("ACTION_NOT_CONFIRMED");
  }

  let passwordHashes: ReadonlyMap<string, string>;
  try {
    const { schoolId } = await requireManagedClassroom(
      database,
      context.actorId,
      payload.classroomId,
    );
    passwordHashes = await hashInitialPasswords(
      database,
      schoolId,
      payload.entries,
    );
  } catch (error) {
    const domainError = toDomainError(error);
    if (domainError) {
      await recordFailureAudit(
        database,
        context,
        executeCommandName,
        payload.classroomId,
        requestHash,
        input.idempotencyKey,
        domainError,
      );
      throw domainError;
    }
    throw error;
  }

  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try {
      return await runExecuteTransaction(
        database,
        context,
        input,
        payload,
        payloadHash,
        requestHash,
        passwordHashes,
      );
    } catch (error) {
      const retryable = isRetryableSerializationError(error);
      if (retryable && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      const domainError =
        toDomainError(error) ??
        (retryable ? new StudentImportError("CONCURRENT_WRITE") : null);
      if (domainError) {
        await recordFailureAudit(
          database,
          context,
          executeCommandName,
          payload.classroomId,
          requestHash,
          input.idempotencyKey,
          domainError,
        );
        throw domainError;
      }
      throw error;
    }
  }
  throw new StudentImportError("CONCURRENT_WRITE");
}
