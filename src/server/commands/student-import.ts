import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashStudentImportPayload, studentImportPayloadSchema } from "../../domain/classroom/student-import-intent";
import { studentRosterEntriesSchema, type StudentRosterEntry } from "../../domain/classroom/student-roster-xlsx";
import type { PrismaClient } from "../../generated/prisma/client";
import { hashLocalPassword, initialStudentPassword, localStudentIdentifier } from "../auth/local-auth";
import { type CommandContext, resolveCommandContext } from "./command-context";

const prepareInputSchema = z.object({ classroomId: z.uuid(), entries: studentRosterEntriesSchema, idempotencyKey: z.string().trim().min(8).max(200) }).strict();
const executeInputSchema = z.object({ actionIntentId: z.uuid(), idempotencyKey: z.string().trim().min(8).max(200) }).strict();
const previewEntrySchema = z.object({ studentNo: z.string().regex(/^[0-9]{6,32}$/u), displayName: z.string().min(1).max(120), status: z.enum(["CREATE", "REUSE", "ALREADY_CURRENT"]) }).strict();
const prepareResultSchema = z.object({ actionIntentId: z.uuid(), classroomName: z.string().min(1), payloadHash: z.string().regex(/^[0-9a-f]{64}$/u), expiresAt: z.iso.datetime({ offset: true }), entries: z.array(previewEntrySchema).min(1).max(100) }).strict();
const executeResultSchema = z.object({ classroomId: z.uuid(), createdStudents: z.int().nonnegative(), reusedStudents: z.int().nonnegative(), joinedStudents: z.int().nonnegative(), skippedCurrentMembers: z.int().nonnegative() }).strict();
export type PrepareStudentImportInput = z.input<typeof prepareInputSchema>;
export type PrepareStudentImportResult = z.infer<typeof prepareResultSchema>;
export type ExecuteStudentImportInput = z.input<typeof executeInputSchema>;
export type ExecuteStudentImportResult = z.infer<typeof executeResultSchema>;

export class StudentImportError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "IDEMPOTENCY_MISMATCH" | "ACTION_NOT_CONFIRMED" | "ACTION_EXPIRED" | "INTENT_TAMPERED" | "CLASSROOM_CHANGED" | "STUDENT_IN_OTHER_CLASSROOM" | "STUDENT_CONFLICT" | "CONCURRENT_WRITE") { super(code); this.name = "StudentImportError"; }
}

const prepareCommandName = "prepare_student_import";
const executeCommandName = "execute_student_import";
const actionName = "import_students_to_classroom";
const lifetimeMs = 10 * 60 * 1000;
type Transaction = Parameters<PrismaClient["$transaction"]>[0] extends (transaction: infer Value) => unknown ? Value : never;

async function requireOwnedClassroom(transaction: Transaction, actorId: string, classroomId: string) {
  const [actor, classroom] = await Promise.all([
    transaction.appUser.findUnique({ where: { id: actorId }, select: { role: true, schoolId: true, accountStatus: true } }),
    transaction.classroom.findUnique({ where: { id: classroomId }, select: { id: true, name: true, managerId: true, schoolId: true, version: true } }),
  ]);
  if (!actor || !classroom) throw new StudentImportError("NOT_FOUND");
  if (actor.role !== "TEACHER" || actor.accountStatus !== "ACTIVE" || classroom.managerId !== actorId || !actor.schoolId || classroom.schoolId !== actor.schoolId) throw new StudentImportError("FORBIDDEN");
  return { actor, classroom };
}

async function makePreview(transaction: Transaction, schoolId: string, classroomId: string, entries: readonly StudentRosterEntry[]) {
  const existing = await transaction.appUser.findMany({ where: { schoolId, studentNo: { in: entries.map((entry) => entry.studentNo) } }, select: { id: true, role: true, studentNo: true } });
  const byStudentNo = new Map(existing.map((student) => [student.studentNo, student]));
  const memberships = await transaction.classroomMembership.findMany({ where: { classroomId, endedAt: null, studentId: { in: existing.map((student) => student.id) } }, select: { studentId: true } });
  const currentIds = new Set(memberships.map((membership) => membership.studentId));
  return entries.map((entry) => {
    const current = byStudentNo.get(entry.studentNo);
    if (!current) return { ...entry, status: "CREATE" as const };
    if (current.role !== "STUDENT") throw new StudentImportError("STUDENT_CONFLICT");
    return { ...entry, status: currentIds.has(current.id) ? "ALREADY_CURRENT" as const : "REUSE" as const };
  });
}

export async function prepareStudentImport(database: PrismaClient, commandContext: CommandContext, rawInput: PrepareStudentImportInput): Promise<PrepareStudentImportResult> {
  const input = prepareInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const result = await database.$transaction(async (transaction) => {
    const { actor, classroom } = await requireOwnedClassroom(transaction, context.actorId, input.classroomId);
    const payload = studentImportPayloadSchema.parse({ schemaVersion: 1, classroomId: classroom.id, classroomName: classroom.name, expectedClassroomVersion: classroom.version, entries: input.entries });
    const payloadHash = hashStudentImportPayload(payload);
    const existing = await transaction.idempotencyRecord.findUnique({ where: { actorId_commandName_idempotencyKey: { actorId: context.actorId, commandName: prepareCommandName, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== payloadHash) throw new StudentImportError("IDEMPOTENCY_MISMATCH");
      return prepareResultSchema.parse(existing.response);
    }
    const preview = await makePreview(transaction, actor.schoolId!, classroom.id, input.entries);
    const expiresAt = new Date(context.now.getTime() + lifetimeMs);
    const actionIntent = await transaction.actionIntent.create({ data: { actorId: context.actorId, actionName, payload, payloadHash, targetType: "Classroom", targetId: classroom.id, expectedVersion: classroom.version, expiresAt } });
    const response = { actionIntentId: actionIntent.id, classroomName: classroom.name, payloadHash, expiresAt: expiresAt.toISOString(), entries: preview };
    await Promise.all([
      transaction.idempotencyRecord.create({ data: { actorId: context.actorId, commandName: prepareCommandName, idempotencyKey: input.idempotencyKey, requestHash: payloadHash, response, resourceType: "ActionIntent", resourceId: actionIntent.id } }),
      transaction.actionAudit.create({ data: { actorId: context.actorId, source: context.source, actionName: prepareCommandName, targetType: "Classroom", targetId: classroom.id, requestHash: payloadHash, idempotencyKey: input.idempotencyKey, outcome: "SUCCEEDED", resultResourceId: actionIntent.id, traceId: context.traceId } }),
    ]);
    return response;
  });
  return prepareResultSchema.parse(result);
}

async function hashEntries(entries: readonly StudentRosterEntry[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const entry of entries) result.set(entry.studentNo, await hashLocalPassword(initialStudentPassword(entry.studentNo)));
  return result;
}

export async function executeStudentImport(database: PrismaClient, commandContext: CommandContext, rawInput: ExecuteStudentImportInput): Promise<ExecuteStudentImportResult> {
  const input = executeInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const intent = await database.actionIntent.findUnique({ where: { id: input.actionIntentId }, select: { payload: true, actorId: true, actionName: true } });
  if (!intent || intent.actorId !== context.actorId || intent.actionName !== actionName) throw new StudentImportError("NOT_FOUND");
  const payload = studentImportPayloadSchema.parse(intent.payload);
  const passwordHashes = await hashEntries(payload.entries);
  const result = await database.$transaction(async (transaction) => {
    const existing = await transaction.idempotencyRecord.findUnique({ where: { actorId_commandName_idempotencyKey: { actorId: context.actorId, commandName: executeCommandName, idempotencyKey: input.idempotencyKey } } });
    const idempotencyHash = `${input.actionIntentId}:${hashStudentImportPayload(payload)}`;
    if (existing) {
      if (existing.requestHash !== idempotencyHash) throw new StudentImportError("IDEMPOTENCY_MISMATCH");
      return executeResultSchema.parse(existing.response);
    }
    const { actor, classroom } = await requireOwnedClassroom(transaction, context.actorId, payload.classroomId);
    const confirmedIntent = await transaction.actionIntent.findUnique({ where: { id: input.actionIntentId } });
    if (!confirmedIntent || confirmedIntent.actorId !== context.actorId || confirmedIntent.decidedById !== context.actorId || confirmedIntent.actionName !== actionName || confirmedIntent.targetId !== classroom.id || confirmedIntent.targetType !== "Classroom" || confirmedIntent.status !== "CONFIRMED" || confirmedIntent.expiresAt <= context.now || confirmedIntent.payloadHash !== hashStudentImportPayload(payload)) throw new StudentImportError(confirmedIntent?.expiresAt && confirmedIntent.expiresAt <= context.now ? "ACTION_EXPIRED" : "ACTION_NOT_CONFIRMED");
    if (classroom.version !== payload.expectedClassroomVersion) throw new StudentImportError("CLASSROOM_CHANGED");
    let createdStudents = 0; let reusedStudents = 0; let joinedStudents = 0; let skippedCurrentMembers = 0;
    for (const entry of payload.entries) {
      let student = await transaction.appUser.findUnique({ where: { schoolId_studentNo: { schoolId: actor.schoolId!, studentNo: entry.studentNo } }, select: { id: true, role: true } });
      if (student && student.role !== "STUDENT") throw new StudentImportError("STUDENT_CONFLICT");
      if (!student) {
        const id = randomUUID();
        await transaction.appUser.create({ data: { id, authSubject: `local:${id}`, role: "STUDENT", displayName: entry.displayName, schoolId: actor.schoolId!, studentNo: entry.studentNo, accountStatus: "ACTIVE", legacyProfile: false } });
        await transaction.localCredential.create({ data: { userId: id, identifier: localStudentIdentifier((await transaction.school.findUniqueOrThrow({ where: { id: actor.schoolId! }, select: { code: true } })).code, entry.studentNo), passwordHash: passwordHashes.get(entry.studentNo)!, mustChangePassword: false, passwordChangedAt: new Date() } });
        student = { id, role: "STUDENT" };
        createdStudents += 1;
      } else reusedStudents += 1;
      const otherMembership = await transaction.classroomMembership.findFirst({ where: { studentId: student.id, endedAt: null, classroomId: { not: classroom.id } }, select: { id: true } });
      if (otherMembership) throw new StudentImportError("STUDENT_IN_OTHER_CLASSROOM");
      const currentMembership = await transaction.classroomMembership.findFirst({ where: { studentId: student.id, classroomId: classroom.id, endedAt: null }, select: { id: true } });
      if (currentMembership) { skippedCurrentMembers += 1; continue; }
      await transaction.classroomMembership.create({ data: { classroomId: classroom.id, studentId: student.id, joinedAt: context.now } });
      joinedStudents += 1;
    }
    if (joinedStudents > 0) await transaction.classroom.update({ where: { id: classroom.id }, data: { version: { increment: 1 } } });
    const response = { classroomId: classroom.id, createdStudents, reusedStudents, joinedStudents, skippedCurrentMembers };
    await Promise.all([
      transaction.actionIntent.update({ where: { id: input.actionIntentId }, data: { status: "EXECUTED", executedAt: context.now } }),
      transaction.idempotencyRecord.create({ data: { actorId: context.actorId, commandName: executeCommandName, idempotencyKey: input.idempotencyKey, requestHash: idempotencyHash, response, resourceType: "Classroom", resourceId: classroom.id } }),
      transaction.actionAudit.create({ data: { actorId: context.actorId, actionIntentId: input.actionIntentId, source: context.source, actionName: executeCommandName, targetType: "Classroom", targetId: classroom.id, requestHash: idempotencyHash, idempotencyKey: input.idempotencyKey, outcome: "SUCCEEDED", resultResourceId: classroom.id, traceId: context.traceId } }),
    ]);
    return response;
  });
  return executeResultSchema.parse(result);
}
