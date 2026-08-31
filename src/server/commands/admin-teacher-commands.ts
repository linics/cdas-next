import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { generateTemporaryPassword } from "../../domain/school/identity";
import { hashLocalPassword } from "../auth/local-auth";
import { requireActivePlatformAdmin } from "../school/admin-authorization";
import { type CommandContext, resolveCommandContext } from "./command-context";

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const setTeacherAccountStatusInputSchema = z.object({ teacherId: z.uuid(), accountStatus: z.enum(["ACTIVE", "DISABLED"]), idempotencyKey: idempotencyKeySchema }).strict();
const resetTeacherPasswordInputSchema = z.object({ teacherId: z.uuid(), idempotencyKey: idempotencyKeySchema }).strict();
const teacherStatusReplaySchema = z.object({ teacherId: z.uuid(), accountStatus: z.enum(["ACTIVE", "DISABLED"]) }).strict();
const passwordResetReplaySchema = z.object({ teacherId: z.uuid() }).strict();
export const setTeacherAccountStatusResultSchema = teacherStatusReplaySchema;
export const resetTeacherPasswordResultSchema = z.object({ teacherId: z.uuid(), status: z.enum(["RESET", "EXISTING"]), temporaryPassword: z.string().min(8).nullable() }).strict();
export type SetTeacherAccountStatusInput = z.input<typeof setTeacherAccountStatusInputSchema>;
export type SetTeacherAccountStatusResult = z.infer<typeof setTeacherAccountStatusResultSchema>;
export type ResetTeacherPasswordInput = z.input<typeof resetTeacherPasswordInputSchema>;
export type ResetTeacherPasswordResult = z.infer<typeof resetTeacherPasswordResultSchema>;
export type TeacherPasswordRandomness = Readonly<{ generateTemporaryPassword: () => string }>;
const defaultPasswordRandomness: TeacherPasswordRandomness = { generateTemporaryPassword };

export class TeacherAdminCommandError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "IDEMPOTENCY_MISMATCH" | "CONCURRENT_WRITE") {
    super(code);
    this.name = "TeacherAdminCommandError";
  }
}

function hashSafeRequest(value: unknown): string {
  const canonicalValue = canonicalize(value);
  if (canonicalValue === undefined) throw new TypeError("Teacher admin command cannot be canonicalized");
  return createHash("sha256").update(canonicalValue).digest("hex");
}

function requireMatchingRequest(existing: { requestHash: string }, requestHash: string): void {
  if (existing.requestHash !== requestHash) throw new TeacherAdminCommandError("IDEMPOTENCY_MISMATCH");
}

type Transaction = Parameters<PrismaClient["$transaction"]>[0] extends (transaction: infer Value) => unknown ? Value : never;

async function requireTeacherTarget(transaction: Transaction, teacherId: string) {
  const teacher = await transaction.appUser.findUnique({ where: { id: teacherId }, select: { id: true, role: true, accountStatus: true } });
  if (!teacher || teacher.role !== "TEACHER") throw new TeacherAdminCommandError("NOT_FOUND");
  return teacher;
}

export async function setTeacherAccountStatus(database: PrismaClient, commandContext: CommandContext, rawInput: SetTeacherAccountStatusInput): Promise<SetTeacherAccountStatusResult> {
  const input = setTeacherAccountStatusInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashSafeRequest({ action: "set_teacher_account_status", teacherId: input.teacherId, accountStatus: input.accountStatus });
  const result = await database.$transaction(async (transaction) => {
    const existing = await transaction.idempotencyRecord.findUnique({ where: { actorId_commandName_idempotencyKey: { actorId: context.actorId, commandName: "set_teacher_account_status", idempotencyKey: input.idempotencyKey } } });
    if (existing) { requireMatchingRequest(existing, requestHash); return teacherStatusReplaySchema.parse(existing.response); }
    try { await requireActivePlatformAdmin(transaction, context.actorId); } catch { throw new TeacherAdminCommandError("FORBIDDEN"); }
    const teacher = await requireTeacherTarget(transaction, input.teacherId);
    const updated = teacher.accountStatus === input.accountStatus ? teacher : await transaction.appUser.update({ where: { id: teacher.id }, data: { accountStatus: input.accountStatus }, select: { id: true, accountStatus: true } });
    const replay = { teacherId: updated.id, accountStatus: updated.accountStatus };
    await Promise.all([
      transaction.idempotencyRecord.create({ data: { actorId: context.actorId, commandName: "set_teacher_account_status", idempotencyKey: input.idempotencyKey, requestHash, response: replay, resourceType: "AppUser", resourceId: updated.id } }),
      transaction.actionAudit.create({ data: { actorId: context.actorId, source: context.source, actionName: "set_teacher_account_status", targetType: "AppUser", targetId: updated.id, requestHash, idempotencyKey: input.idempotencyKey, outcome: "SUCCEEDED", resultResourceId: updated.id, traceId: context.traceId } }),
      ...(input.accountStatus === "DISABLED" ? [transaction.authSession.updateMany({ where: { userId: updated.id, revokedAt: null }, data: { revokedAt: new Date() } })] : []),
    ]);
    return replay;
  });
  return setTeacherAccountStatusResultSchema.parse(result);
}

/** Resets a teacher's local credential and revokes every existing session atomically. */
export async function resetTeacherPassword(database: PrismaClient, commandContext: CommandContext, rawInput: ResetTeacherPasswordInput, randomness: TeacherPasswordRandomness = defaultPasswordRandomness): Promise<ResetTeacherPasswordResult> {
  const input = resetTeacherPasswordInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashSafeRequest({ action: "reset_teacher_password", teacherId: input.teacherId });
  const temporaryPassword = randomness.generateTemporaryPassword();
  const passwordHash = await hashLocalPassword(temporaryPassword);
  const result = await database.$transaction(async (transaction) => {
    const existing = await transaction.idempotencyRecord.findUnique({ where: { actorId_commandName_idempotencyKey: { actorId: context.actorId, commandName: "reset_teacher_password", idempotencyKey: input.idempotencyKey } } });
    if (existing) { requireMatchingRequest(existing, requestHash); return { teacherId: passwordResetReplaySchema.parse(existing.response).teacherId, status: "EXISTING" as const, temporaryPassword: null }; }
    try { await requireActivePlatformAdmin(transaction, context.actorId); } catch { throw new TeacherAdminCommandError("FORBIDDEN"); }
    const teacher = await requireTeacherTarget(transaction, input.teacherId);
    const credential = await transaction.localCredential.findUnique({ where: { userId: teacher.id }, select: { id: true } });
    if (!credential) throw new TeacherAdminCommandError("NOT_FOUND");
    const replay = { teacherId: teacher.id };
    await Promise.all([
      transaction.localCredential.update({ where: { id: credential.id }, data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } }),
      transaction.authSession.updateMany({ where: { userId: teacher.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      transaction.idempotencyRecord.create({ data: { actorId: context.actorId, commandName: "reset_teacher_password", idempotencyKey: input.idempotencyKey, requestHash, response: replay, resourceType: "AppUser", resourceId: teacher.id } }),
      transaction.actionAudit.create({ data: { actorId: context.actorId, source: context.source, actionName: "reset_teacher_password", targetType: "AppUser", targetId: teacher.id, requestHash, idempotencyKey: input.idempotencyKey, outcome: "SUCCEEDED", resultResourceId: teacher.id, traceId: context.traceId } }),
    ]);
    return { teacherId: teacher.id, status: "RESET" as const, temporaryPassword };
  });
  return resetTeacherPasswordResultSchema.parse(result);
}
