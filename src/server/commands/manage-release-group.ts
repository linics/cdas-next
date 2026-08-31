import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  isSerializationFailure,
  serializableRetryAttempts,
  waitBeforeSerializableRetry,
} from "./serializable-retry";
import {
  type CommandContext,
  type ResolvedCommandContext,
  resolveCommandContext,
} from "./command-context";

const memberSchema = z.strictObject({
  studentId: z.uuid(),
  roleLabel: z.string().trim().min(1).max(120).nullable(),
});

const saveInputSchema = z.strictObject({
  releaseId: z.uuid(),
  groupId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  members: z.array(memberSchema).min(1).max(60),
  idempotencyKey: z.string().trim().min(8).max(200),
}).superRefine((input, issue) => {
  const seen = new Set<string>();
  input.members.forEach((member, index) => {
    if (seen.has(member.studentId)) {
      issue.addIssue({ code: "custom", path: ["members", index, "studentId"], message: "A student can only appear once" });
    }
    seen.add(member.studentId);
  });
});

const deleteInputSchema = z.strictObject({
  releaseId: z.uuid(),
  groupId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

const groupResponseSchema = z.strictObject({
  groupId: z.uuid(),
  name: z.string().min(1),
  members: z.array(memberSchema),
  savedAt: z.iso.datetime({ offset: true }),
});
const deleteResponseSchema = z.strictObject({ groupId: z.uuid(), deletedAt: z.iso.datetime({ offset: true }) });

export type SaveReleaseGroupInput = z.input<typeof saveInputSchema>;
export type SaveReleaseGroupResult = z.infer<typeof groupResponseSchema>;
export type DeleteReleaseGroupInput = z.input<typeof deleteInputSchema>;
export type DeleteReleaseGroupResult = z.infer<typeof deleteResponseSchema>;

export class ManageReleaseGroupError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "RELEASE_NOT_ACTIVE" | "GROUP_LOCKED" | "INVALID_MEMBERS" | "PERSONAL_SUBMISSION_EXISTS" | "IDEMPOTENCY_MISMATCH" | "CONCURRENT_WRITE") {
    super(code);
    this.name = "ManageReleaseGroupError";
  }
}

function hashValue(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new TypeError("Command input cannot be canonicalized");
  return createHash("sha256").update(canonical).digest("hex");
}

async function assertManager(transaction: Prisma.TransactionClient, releaseId: string, actorId: string) {
  const release = await transaction.activityRelease.findFirst({
    where: { id: releaseId, publisherId: actorId, classroom: { managerId: actorId } },
    select: { id: true, status: true },
  });
  if (!release) throw new ManageReleaseGroupError("NOT_FOUND");
  if (release.status !== "ACTIVE") throw new ManageReleaseGroupError("RELEASE_NOT_ACTIVE");
}

async function assertMembersCanJoin(transaction: Prisma.TransactionClient, releaseId: string, memberIds: string[], now: Date) {
  const release = await transaction.activityRelease.findUnique({
    where: { id: releaseId },
    select: { classroomId: true },
  });
  if (!release) throw new ManageReleaseGroupError("NOT_FOUND");
  const eligible = await transaction.classroomMembership.findMany({
    where: { classroomId: release.classroomId, studentId: { in: memberIds }, joinedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }], student: { role: "STUDENT" } },
    select: { studentId: true },
  });
  if (eligible.length !== memberIds.length) throw new ManageReleaseGroupError("INVALID_MEMBERS");
  const personal = await transaction.submission.findFirst({
    where: { releaseId, studentId: { in: memberIds } },
    select: { id: true },
  });
  if (personal) throw new ManageReleaseGroupError("PERSONAL_SUBMISSION_EXISTS");
}

async function saveGroupTransaction(database: PrismaClient, context: ResolvedCommandContext, input: z.infer<typeof saveInputSchema>, requestHash: string): Promise<SaveReleaseGroupResult> {
  return database.$transaction(async (transaction) => {
    const commandName = "save_release_group";
    const existing = await transaction.idempotencyRecord.findUnique({ where: { actorId_commandName_idempotencyKey: { actorId: context.actorId, commandName, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ManageReleaseGroupError("IDEMPOTENCY_MISMATCH");
      return groupResponseSchema.parse(existing.response);
    }
    await assertManager(transaction, input.releaseId, context.actorId);
    await assertMembersCanJoin(transaction, input.releaseId, input.members.map((member) => member.studentId), context.now);
    let groupId: string;
    if (input.groupId) {
      const existingGroup = await transaction.releaseGroup.findFirst({ where: { id: input.groupId, releaseId: input.releaseId }, select: { id: true, submissions: { select: { id: true }, take: 1 } } });
      if (!existingGroup) throw new ManageReleaseGroupError("NOT_FOUND");
      if (existingGroup.submissions.length > 0) throw new ManageReleaseGroupError("GROUP_LOCKED");
      groupId = existingGroup.id;
      await transaction.releaseGroup.update({ where: { id: groupId }, data: { name: input.name, updatedAt: context.now } });
      await transaction.releaseGroupMember.deleteMany({ where: { groupId } });
    } else {
      const created = await transaction.releaseGroup.create({ data: { releaseId: input.releaseId, name: input.name, createdAt: context.now, updatedAt: context.now } });
      groupId = created.id;
    }
    await transaction.releaseGroupMember.createMany({ data: input.members.map((member) => ({ groupId, studentId: member.studentId, roleLabel: member.roleLabel, createdAt: context.now })) });
    const response = { groupId, name: input.name, members: input.members, savedAt: context.now.toISOString() } satisfies SaveReleaseGroupResult;
    await transaction.actionAudit.create({ data: { actorId: context.actorId, source: context.source, actionName: commandName, targetType: "ReleaseGroup", targetId: groupId, requestHash, idempotencyKey: input.idempotencyKey, outcome: "SUCCEEDED", resultResourceId: groupId, traceId: context.traceId } });
    await transaction.idempotencyRecord.create({ data: { actorId: context.actorId, commandName, idempotencyKey: input.idempotencyKey, requestHash, response, resourceType: "ReleaseGroup", resourceId: groupId } });
    return response;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
}

export async function saveReleaseGroup(database: PrismaClient, commandContext: CommandContext, rawInput: SaveReleaseGroupInput): Promise<SaveReleaseGroupResult> {
  const input = saveInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({ releaseId: input.releaseId, groupId: input.groupId, name: input.name, members: input.members });
  for (let attempt = 1; attempt <= serializableRetryAttempts; attempt += 1) {
    try { return await saveGroupTransaction(database, context, input, requestHash); }
    catch (error) {
      const retryable = isSerializationFailure(error);
      if (retryable && attempt < serializableRetryAttempts) {
        await waitBeforeSerializableRetry(attempt);
        continue;
      }
      if (retryable) throw new ManageReleaseGroupError("CONCURRENT_WRITE");
      throw error;
    }
  }
  throw new ManageReleaseGroupError("CONCURRENT_WRITE");
}

export async function deleteReleaseGroup(database: PrismaClient, commandContext: CommandContext, rawInput: DeleteReleaseGroupInput): Promise<DeleteReleaseGroupResult> {
  const input = deleteInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const requestHash = hashValue({ releaseId: input.releaseId, groupId: input.groupId });
  return database.$transaction(async (transaction) => {
    const commandName = "delete_release_group";
    const existing = await transaction.idempotencyRecord.findUnique({ where: { actorId_commandName_idempotencyKey: { actorId: context.actorId, commandName, idempotencyKey: input.idempotencyKey } } });
    if (existing) { if (existing.requestHash !== requestHash) throw new ManageReleaseGroupError("IDEMPOTENCY_MISMATCH"); return deleteResponseSchema.parse(existing.response); }
    await assertManager(transaction, input.releaseId, context.actorId);
    const group = await transaction.releaseGroup.findFirst({ where: { id: input.groupId, releaseId: input.releaseId }, select: { id: true, submissions: { select: { id: true }, take: 1 } } });
    if (!group) throw new ManageReleaseGroupError("NOT_FOUND");
    if (group.submissions.length > 0) throw new ManageReleaseGroupError("GROUP_LOCKED");
    await transaction.releaseGroupMember.deleteMany({ where: { groupId: group.id } });
    await transaction.releaseGroup.delete({ where: { id: group.id } });
    const response = { groupId: group.id, deletedAt: context.now.toISOString() } satisfies DeleteReleaseGroupResult;
    await transaction.actionAudit.create({ data: { actorId: context.actorId, source: context.source, actionName: commandName, targetType: "ReleaseGroup", targetId: group.id, requestHash, idempotencyKey: input.idempotencyKey, outcome: "SUCCEEDED", resultResourceId: group.id, traceId: context.traceId } });
    await transaction.idempotencyRecord.create({ data: { actorId: context.actorId, commandName, idempotencyKey: input.idempotencyKey, requestHash, response, resourceType: "ReleaseGroup", resourceId: group.id } });
    return response;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
}
