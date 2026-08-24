"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseRosterKeyList, rosterKeySchema } from "../../../../../domain/classroom/roster-key";
import { AuthenticationError } from "../../../../../server/auth/current-actor";
import {
  applyClassroomMembershipChange,
  ApplyClassroomMembershipChangeError,
} from "../../../../../server/commands/apply-classroom-membership-change";
import { createUiCommandContext } from "../../../../../server/commands/create-ui-command-context";
import {
  decideActionIntent,
  DecideActionIntentError,
} from "../../../../../server/commands/decide-action-intent";
import {
  prepareClassroomMembershipChange,
  PrepareClassroomMembershipChangeError,
  type PrepareClassroomMembershipChangeResult,
} from "../../../../../server/commands/prepare-classroom-membership-change";
import { getDatabaseClient } from "../../../../../server/db/client";
import {
  previewTeacherRosterImport,
  TeacherClassroomRosterQueryError,
  type RosterImportPreview,
} from "../../../../../server/queries/teacher-classroom-roster";

const previewSchema = z
  .object({ classroomId: z.uuid(), rosterText: z.string().min(1).max(4_000) })
  .strict();
const prepareAddSchema = z
  .object({
    classroomId: z.uuid(),
    rosterKeys: z.array(rosterKeySchema).min(1).max(50),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();
const prepareEndSchema = z
  .object({
    classroomId: z.uuid(),
    membershipId: z.uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();
const decisionSchema = z
  .object({
    actionIntentId: z.uuid(),
    decision: z.enum(["CONFIRM", "REJECT"]),
    idempotencyKey: z.string().trim().min(8).max(200),
  })
  .strict();

export type RosterActionFailure = Readonly<{
  ok: false;
  code: "VALIDATION" | "UNAUTHORIZED" | "CONFLICT" | "ERROR";
  message: string;
}>;
export type RosterPreviewActionResult =
  | Readonly<{
      ok: true;
      preview: RosterImportPreview;
      duplicates: string[];
    }>
  | RosterActionFailure;
export type RosterPrepareActionResult =
  | Readonly<{
      ok: true;
      confirmation: PrepareClassroomMembershipChangeResult;
      applyIdempotencyKey: string;
    }>
  | RosterActionFailure;
export type RosterDecisionActionResult =
  | Readonly<{
      ok: true;
      status: "APPLIED" | "REJECTED";
      message: string;
    }>
  | RosterActionFailure;

function failure(error: unknown): RosterActionFailure {
  if (error instanceof z.ZodError || (error instanceof Error && error.message === "ROSTER_KEY_COUNT_INVALID")) {
    return { ok: false, code: "VALIDATION", message: "名单码格式不正确；每次请输入 1–50 个名单码。" };
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof TeacherClassroomRosterQueryError ||
    (error instanceof PrepareClassroomMembershipChangeError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)) ||
    (error instanceof ApplyClassroomMembershipChangeError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)) ||
    (error instanceof DecideActionIntentError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code))
  ) {
    return { ok: false, code: "UNAUTHORIZED", message: "当前账号不能管理这个班级的成员。" };
  }
  if (
    error instanceof PrepareClassroomMembershipChangeError ||
    error instanceof ApplyClassroomMembershipChangeError ||
    error instanceof DecideActionIntentError
  ) {
    return { ok: false, code: "CONFLICT", message: "名单、成员状态或班级版本已经变化，请刷新后重新预览。" };
  }
  console.error("Classroom roster action failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return { ok: false, code: "ERROR", message: "服务器暂时无法完成名单操作，现有成员关系没有被假设为已改变。" };
}

export async function previewRosterImportAction(
  rawInput: z.input<typeof previewSchema>,
): Promise<RosterPreviewActionResult> {
  try {
    const input = previewSchema.parse(rawInput);
    const parsed = parseRosterKeyList(input.rosterText);
    const preview = await previewTeacherRosterImport(
      getDatabaseClient(),
      await createUiCommandContext(),
      { classroomId: input.classroomId, rosterKeys: parsed.keys },
    );
    return { ok: true, preview, duplicates: parsed.duplicates };
  } catch (error) {
    return failure(error);
  }
}

export async function prepareRosterImportAction(
  rawInput: z.input<typeof prepareAddSchema>,
): Promise<RosterPrepareActionResult> {
  try {
    const input = prepareAddSchema.parse(rawInput);
    const confirmation = await prepareClassroomMembershipChange(
      getDatabaseClient(),
      await createUiCommandContext(),
      { ...input, operation: "ADD" },
    );
    return {
      ok: true,
      confirmation,
      applyIdempotencyKey: `apply_roster_${randomUUID()}`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function prepareEndMembershipAction(
  rawInput: z.input<typeof prepareEndSchema>,
): Promise<RosterPrepareActionResult> {
  try {
    const input = prepareEndSchema.parse(rawInput);
    const confirmation = await prepareClassroomMembershipChange(
      getDatabaseClient(),
      await createUiCommandContext(),
      { ...input, operation: "END" },
    );
    return {
      ok: true,
      confirmation,
      applyIdempotencyKey: `apply_roster_${randomUUID()}`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function decideRosterChangeAction(
  rawInput: z.input<typeof decisionSchema>,
): Promise<RosterDecisionActionResult> {
  try {
    const input = decisionSchema.parse(rawInput);
    const database = getDatabaseClient();
    const context = await createUiCommandContext();
    try {
      await decideActionIntent(database, context, {
        actionIntentId: input.actionIntentId,
        decision: input.decision,
      });
    } catch (error) {
      if (
        input.decision !== "CONFIRM" ||
        !(error instanceof DecideActionIntentError) ||
        error.code !== "ALREADY_DECIDED"
      ) {
        throw error;
      }
      // The apply command's idempotency record is the only path that may turn
      // an already executed confirmation into a successful response replay.
    }
    if (input.decision === "REJECT") {
      return { ok: true, status: "REJECTED", message: "已取消这次成员变更，班级名单保持不变。" };
    }
    await applyClassroomMembershipChange(database, context, {
      actionIntentId: input.actionIntentId,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath("/teacher");
    revalidatePath("/student");
    return { ok: true, status: "APPLIED", message: "班级成员关系已更新，历史区间已保留。" };
  } catch (error) {
    return failure(error);
  }
}
