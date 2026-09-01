"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseRosterKeyList, rosterKeySchema } from "../../../../../domain/classroom/roster-key";
import {
  MAX_ROSTER_IMPORT_ROWS,
  parseStudentRosterWorkbook,
  type ParsedRosterRow,
  StudentRosterFileError,
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
import type { ClassifiedImportRow } from "../../../../../server/classroom/student-import-classification";
import {
  previewStudentImport,
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

const fileErrorMessages: Readonly<Record<StudentRosterFileError["code"], string>> = {
  INVALID_WORKBOOK: "无法读取这个文件；请上传由模板另存的 .xlsx 工作簿（不超过 900 KB）。",
  INVALID_HEADER: "首个工作表的第一行必须且只能是「学号、姓名」两列。",
  INVALID_COLUMNS: "工作表只能包含「学号、姓名」两列，请删除其他列后重试。",
  EMPTY_FILE: "首个工作表除表头外没有任何数据行。",
  TOO_MANY_ROWS: `一次最多导入 ${MAX_ROSTER_IMPORT_ROWS} 名学生，请拆分文件。`,
};

function failure(error: unknown): RosterActionFailure {
  if (error instanceof StudentRosterFileError) {
    return { ok: false, code: "VALIDATION", message: fileErrorMessages[error.code] };
  }
  if (error instanceof z.ZodError || (error instanceof Error && error.message === "ROSTER_KEY_COUNT_INVALID")) {
    return { ok: false, code: "VALIDATION", message: "名单码格式不正确；每次请输入 1–50 个名单码。" };
  }
  if (
    error instanceof StudentImportError &&
    ["FORBIDDEN", "NOT_FOUND", "ACCOUNT_DISABLED", "SCHOOL_DISABLED"].includes(error.code)
  ) {
    return { ok: false, code: "UNAUTHORIZED", message: "当前账号不能管理这个班级的成员。" };
  }
  if (error instanceof StudentImportError) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "名单或班级状态已经变化，本次没有创建任何账号；请重新上传预览。",
    };
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

export type StudentImportReportRow =
  | Readonly<{ kind: "CLASSIFIED" } & ClassifiedImportRow>
  | Readonly<{
      kind: "FILE_ISSUE";
      rowNumber: number;
      issue: Extract<ParsedRosterRow, { ok: false }>["issue"];
      studentNoText: string;
      displayNameText: string;
    }>;

export type StudentImportPrepared = Readonly<{
  confirmation: PrepareStudentImportResult;
  applyIdempotencyKey: string;
}>;

export type StudentImportPreviewActionResult =
  | Readonly<{
      ok: true;
      rows: StudentImportReportRow[];
      importable: StudentRosterEntry[];
      prepared: StudentImportPrepared | null;
    }>
  | RosterActionFailure;

/**
 * Parses the uploaded workbook and reports, row by row, what an import would
 * do. The file itself is never stored: only the normalized preview travels on.
 */
export async function previewStudentImportAction(
  formData: FormData,
): Promise<StudentImportPreviewActionResult> {
  try {
    const file = formData.get("file");
    const classroomId = z.uuid().parse(formData.get("classroomId"));
    const idempotencyKey = z.string().trim().min(8).max(200).parse(
      formData.get("idempotencyKey"),
    );
    if (
      !(file instanceof File) ||
      !file.name.toLowerCase().endsWith(".xlsx") ||
      file.size === 0 ||
      // Next's default server-action body limit is 1 MB; a 100-row roster is
      // a few dozen kilobytes, so the cap is never the binding constraint.
      file.size > 900 * 1024
    ) {
      throw new StudentRosterFileError("INVALID_WORKBOOK");
    }

    const context = await createUiCommandContext();
    const database = getDatabaseClient();
    // Server Actions are public POST endpoints. Re-check the active teacher,
    // school and managed classroom before expanding attacker-controlled XLSX
    // bytes. An empty preview performs only that resource authorization.
    await previewStudentImport(database, context, { classroomId, rows: [] });

    const parsed = parseStudentRosterWorkbook(await file.arrayBuffer());
    const okRows = parsed.flatMap((row) =>
      row.ok ? [{ rowNumber: row.rowNumber, entry: row.entry }] : [],
    );
    const classified = okRows.length
      ? (
          await previewStudentImport(
            database,
            context,
            { classroomId, rows: okRows },
          )
        ).rows
      : [];
    const byRowNumber = new Map(classified.map((row) => [row.rowNumber, row]));
    const rows: StudentImportReportRow[] = parsed.map((row) => {
      if (!row.ok) {
        return {
          kind: "FILE_ISSUE" as const,
          rowNumber: row.rowNumber,
          issue: row.issue,
          studentNoText: row.studentNoText,
          displayNameText: row.displayNameText,
        };
      }
      const classifiedRow = byRowNumber.get(row.rowNumber)!;
      return { kind: "CLASSIFIED" as const, ...classifiedRow };
    });
    const importable = rows.flatMap((row) =>
      row.kind === "CLASSIFIED" && (row.status === "CREATE" || row.status === "REUSE")
        ? [{ studentNo: row.studentNo, displayName: row.displayName }]
        : [],
    );
    const confirmation = importable.length > 0
      ? await prepareStudentImport(database, context, {
          classroomId,
          entries: importable,
          idempotencyKey,
        })
      : null;
    return {
      ok: true,
      rows,
      importable,
      prepared: confirmation
        ? {
            confirmation,
            applyIdempotencyKey: `apply_student_import_${randomUUID()}`,
          }
        : null,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function decideStudentImportAction(
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
      // Only the import command's idempotency record may replay an already
      // executed confirmation as success.
    }
    if (input.decision === "REJECT") {
      return {
        ok: true,
        status: "REJECTED",
        message: "已取消这次导入，没有创建任何账号或成员关系。",
      };
    }
    const result = await executeStudentImport(database, context, {
      actionIntentId: input.actionIntentId,
      idempotencyKey: input.idempotencyKey,
    });
    revalidatePath("/teacher");
    revalidatePath("/student");
    return {
      ok: true,
      status: "APPLIED",
      message: `已完成导入：新建账号 ${result.createdStudents} 个，加入本班 ${result.joinedStudents} 名；已在本班的 ${result.skippedCurrentMembers} 名保持不变。`,
    };
  } catch (error) {
    return failure(error);
  }
}
