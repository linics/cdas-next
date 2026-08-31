import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { requireActiveTeacher } from "../school/teacher-authorization";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";

const inputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();
const resultSchema = z
  .object({
    classroomId: z.uuid(),
    name: z.string().trim().min(1),
    managerId: z.uuid(),
    schoolId: z.uuid(),
  })
  .strict();

export type CreateClassroomInput = z.input<typeof inputSchema>;
export type CreateClassroomResult = z.infer<typeof resultSchema>;

export class CreateClassroomError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "CreateClassroomError";
  }
}

function requestHash(input: z.infer<typeof inputSchema>): string {
  const value = canonicalize({ action: "create_classroom", name: input.name });
  if (value === undefined) throw new TypeError("Classroom input cannot be canonicalized");
  return createHash("sha256").update(value).digest("hex");
}

export async function createClassroom(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: CreateClassroomInput,
): Promise<CreateClassroomResult> {
  const input = inputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const hash = requestHash(input);
  const result = await database.$transaction(async (transaction) => {
    const existing = await transaction.idempotencyRecord.findUnique({
      where: {
        actorId_commandName_idempotencyKey: {
          actorId: context.actorId,
          commandName: "create_classroom",
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new CreateClassroomError("IDEMPOTENCY_MISMATCH");
      }
      return resultSchema.parse(existing.response);
    }
    let actor;
    try {
      actor = await requireActiveTeacher(transaction, context.actorId);
    } catch {
      throw new CreateClassroomError("FORBIDDEN");
    }
    const classroom = await transaction.classroom.create({
      data: {
        name: input.name,
        managerId: context.actorId,
        schoolId: actor.schoolId,
      },
      select: { id: true, name: true, managerId: true, schoolId: true },
    });
    const response = {
      classroomId: classroom.id,
      name: classroom.name,
      managerId: classroom.managerId,
      schoolId: classroom.schoolId,
    };
    await Promise.all([
      transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName: "create_classroom",
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          response,
          resourceType: "Classroom",
          resourceId: classroom.id,
        },
      }),
      transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: "create_classroom",
          targetType: "Classroom",
          targetId: classroom.id,
          requestHash: hash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          resultResourceId: classroom.id,
          traceId: context.traceId,
        },
      }),
    ]);
    return response;
  });
  return resultSchema.parse(result);
}
