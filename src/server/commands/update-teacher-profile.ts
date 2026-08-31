import "server-only";

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { teacherProfileFieldsSchema } from "../../domain/school/teacher-profile";
import type { PrismaClient } from "../../generated/prisma/client";
import { requireActiveTeacher } from "../school/teacher-authorization";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";

const inputSchema = teacherProfileFieldsSchema
  .extend({ idempotencyKey: z.string().trim().min(8).max(200) })
  .strict();
const resultSchema = teacherProfileFieldsSchema
  .extend({ teacherId: z.uuid() })
  .strict();

export type UpdateTeacherProfileInput = z.input<typeof inputSchema>;
export type UpdateTeacherProfileResult = z.infer<typeof resultSchema>;

export class UpdateTeacherProfileError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "IDEMPOTENCY_MISMATCH"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "UpdateTeacherProfileError";
  }
}

function requestHash(input: z.infer<typeof inputSchema>): string {
  const value = canonicalize({
    action: "update_teacher_profile",
    displayName: input.displayName,
    primaryDisciplineCode: input.primaryDisciplineCode,
    secondaryDisciplineCodes: input.secondaryDisciplineCodes,
  });
  if (value === undefined) throw new TypeError("Teacher profile cannot be canonicalized");
  return createHash("sha256").update(value).digest("hex");
}

export async function updateTeacherProfile(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: UpdateTeacherProfileInput,
): Promise<UpdateTeacherProfileResult> {
  const input = inputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const hash = requestHash(input);
  const result = await database.$transaction(async (transaction) => {
    const existing = await transaction.idempotencyRecord.findUnique({
      where: {
        actorId_commandName_idempotencyKey: {
          actorId: context.actorId,
          commandName: "update_teacher_profile",
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new UpdateTeacherProfileError("IDEMPOTENCY_MISMATCH");
      }
      return resultSchema.parse(existing.response);
    }
    try {
      await requireActiveTeacher(transaction, context.actorId);
    } catch {
      throw new UpdateTeacherProfileError("FORBIDDEN");
    }
    const updated = await transaction.appUser.update({
      where: { id: context.actorId },
      data: {
        displayName: input.displayName,
        primaryDisciplineCode: input.primaryDisciplineCode,
        secondaryDisciplineCodes: input.secondaryDisciplineCodes,
      },
      select: {
        id: true,
        displayName: true,
        primaryDisciplineCode: true,
        secondaryDisciplineCodes: true,
      },
    });
    const response = {
      teacherId: updated.id,
      displayName: updated.displayName,
      primaryDisciplineCode: updated.primaryDisciplineCode,
      secondaryDisciplineCodes: updated.secondaryDisciplineCodes,
    };
    await Promise.all([
      transaction.idempotencyRecord.create({
        data: {
          actorId: context.actorId,
          commandName: "update_teacher_profile",
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          response,
          resourceType: "AppUser",
          resourceId: context.actorId,
        },
      }),
      transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: "update_teacher_profile",
          targetType: "AppUser",
          targetId: context.actorId,
          requestHash: hash,
          idempotencyKey: input.idempotencyKey,
          outcome: "SUCCEEDED",
          resultResourceId: context.actorId,
          traceId: context.traceId,
        },
      }),
    ]);
    return response;
  });
  return resultSchema.parse(result);
}
