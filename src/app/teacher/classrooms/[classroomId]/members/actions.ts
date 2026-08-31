"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseRosterKeyList, rosterKeySchema } from "../../../../../domain/classroom/roster-key";
import {
  parseStudentRosterXlsx,
  StudentRosterXlsxError,
  type StudentRosterEntry,
} from "../../../../../domain/classroom/student-roster-xlsx";
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
import {
  executeStudentImport,
  prepareStudentImport,
  StudentImportError,
  type PrepareStudentImportResult,
} from "../../../../../server/commands/student-import";
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
export type StudentImportPreviewActionResult =
  | Readonly<{ ok: true; entries: StudentRosterEntry[] }>
  | RosterActionFailure;
export type StudentImportPrepareActionResult =
  | Readonly<{ ok: true; confirmation: PrepareStudentImportResult; applyIdempotencyKey: string }>
  | RosterActionFailure;

function failure(error: unknown): RosterActionFailure {
  if (error instanceof z.ZodError || (error instanceof Error && error.message === "ROSTER_KEY_COUNT_INVALID")) {
    return { ok: false, code: "VALIDATION", message: "名单码格式不正确；每次请输入 1–50 个名单码。" };
  }
  if (error instanceof StudentRosterXlsxError) {
    const message = error.code === "INVALID_HEADER"
      ? "首个工作表第一行必须且只能是“学号、姓名”两列。"
      : error.code === "TOO_MANY_ROWS"
        ? "一次最多导入 100 名学生。"
        : "Excel 文件或其中的学号、姓名不符合模板要求。";
    return { ok: false, code: "VALIDATION", message };
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof TeacherClassroomRosterQueryError ||
    (error instanceof StudentImportError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)) ||
    (error instanceof PrepareClassroomMembershipChangeError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)) ||
    (error instanceof ApplyClassroomMembershipChangeError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)) ||
    (error instanceof DecideActionIntentError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code))
  ) {
    return { ok: false, code: "UNAUTHORIZED", message: "当前账号不能管理这个班级的成员。" };
  }
  if (error instanceof StudentImportError) {
    const message = error.code === "ACTION_EXPIRED"
      ? "本次导入确认已过期，请重新选择 Excel 文件并预览。"
      : error.code === "CLASSROOM_CHANGED"
        ? "班级成员已更新，请重新选择 Excel 文件并预览后再导入。"
        : error.code === "STUDENT_IN_OTHER_CLASSROOM"
          ? "名单中有学生已经属于其他班级；系统未写入任何本次导入内容，请调整名单后重试。"
          : error.code === "STUDENT_CONFLICT"
            ? "名单中的学号与学校内非学生账号冲突；系统未写入任何本次导入内容。"
            : error.code === "CONCURRENT_WRITE"
              ? "名单正在被其他操作更新，请刷新后重新预览。"
              : "导入确认状态已经变化，请重新选择 Excel 文件并预览。";
    return { ok: false, code: "CONFLICT", message };
  }
  if (error instanceof DecideActionIntentError && error.code === "ACTION_EXPIRED") {
    return { ok: false, code: "CONFLICT", message: "本次导入确认已过期，请重新选择 Excel 文件并预览。" };
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

export async function previewStudentImportAction(formData: FormData): Promise<StudentImportPreviewActionResult> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size === 0 || file.size > 2 * 1024 * 1024) {
      throw new StudentRosterXlsxError("INVALID_WORKBOOK");
    }
    return { ok: true, entries: parseStudentRosterXlsx(await file.arrayBuffer()) };
  } catch (error) { return failure(error); }
}

export async function prepareStudentImportAction(rawInput: { classroomId: string; entries: StudentRosterEntry[]; idempotencyKey: string }): Promise<StudentImportPrepareActionResult> {
  try {
    const confirmation = await prepareStudentImport(getDatabaseClient(), await createUiCommandContext(), rawInput);
    return { ok: true, confirmation, applyIdempotencyKey: `apply_student_import_${randomUUID()}` };
  } catch (error) { return failure(error); }
}

export async function decideStudentImportAction(rawInput: { actionIntentId: string; decision: "CONFIRM" | "REJECT"; idempotencyKey: string }): Promise<RosterDecisionActionResult> {
  try {
    const input = decisionSchema.parse(rawInput);
    const database = getDatabaseClient();
    const context = await createUiCommandContext();
    try { await decideActionIntent(database, context, { actionIntentId: input.actionIntentId, decision: input.decision }); }
    catch (error) {
      if (input.decision !== "CONFIRM" || !(error instanceof DecideActionIntentError) || error.code !== "ALREADY_DECIDED") throw error;
    }
    if (input.decision === "REJECT") return { ok: true, status: "REJECTED", message: "已取消本次学生账号导入，未创建任何账号或成员关系。" };
    const result = await executeStudentImport(database, context, { actionIntentId: input.actionIntentId, idempotencyKey: input.idempotencyKey });
    revalidatePath("/teacher");
    revalidatePath("/student");
    return { ok: true, status: "APPLIED", message: `已完成导入：新建 ${result.createdStudents} 名账号，加入班级 ${result.joinedStudents} 名；已在本班的 ${result.skippedCurrentMembers} 名保持不变。` };
  } catch (error) { return failure(error); }
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
