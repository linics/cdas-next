"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError } from "../../../server/auth/current-actor";
import {
  ActivityDraftWorkingCopyError,
  discardActivityDraftWorkingCopy,
  saveActivityDraftWorkingCopy,
} from "../../../server/commands/activity-draft-working-copy";
import { createUiCommandContext } from "../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../server/db/client";

export type TaskBookAutosaveResult =
  | Readonly<{ status: "saved"; workingCopyId: string; version: number; savedAt: string }>
  | Readonly<{ status: "stale" }>
  | Readonly<{ status: "failed"; message: string }>;

const autosaveSchema = z
  .object({
    workingCopyId: z.uuid().nullable(),
    draftId: z.uuid().nullable(),
    expectedVersion: z.int().positive().nullable(),
    content: z.string().min(2).max(200_000),
  })
  .strict();

/** D-093: keeps whatever the teacher has typed, complete or not. */
export async function autosaveTaskBookAction(
  rawInput: z.input<typeof autosaveSchema>,
): Promise<TaskBookAutosaveResult> {
  try {
    const input = autosaveSchema.parse(rawInput);
    const context = await createUiCommandContext();
    const saved = await saveActivityDraftWorkingCopy(getDatabaseClient(), context, {
      workingCopyId: input.workingCopyId,
      draftId: input.draftId,
      expectedVersion: input.expectedVersion,
      content: JSON.parse(input.content),
    });
    if (input.workingCopyId === null) revalidatePath("/teacher/activities");
    return { status: "saved", ...saved };
  } catch (error) {
    if (error instanceof ActivityDraftWorkingCopyError && error.code === "STALE_VERSION") {
      return { status: "stale" };
    }
    if (error instanceof AuthenticationError) {
      return { status: "failed", message: "登录状态已失效，内容还在本页，请重新登录后再保存。" };
    }
    if (
      error instanceof ActivityDraftWorkingCopyError &&
      ["NOT_FOUND", "FORBIDDEN", "DRAFT_SEALED"].includes(error.code)
    ) {
      return { status: "failed", message: "这份任务书现在不能再修改，自动保存已停止。" };
    }
    console.error("Task-book autosave failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { status: "failed", message: "自动保存暂时失败，内容还在本页，稍后会再试。" };
  }
}

const discardSchema = z
  .object({ workingCopyId: z.uuid(), draftId: z.uuid().nullable() })
  .strict();

/** The teacher keeps the saved version and drops the unsaved edits. */
export async function discardTaskBookWorkingCopyAction(
  rawInput: z.input<typeof discardSchema>,
): Promise<{ ok: boolean }> {
  try {
    const input = discardSchema.parse(rawInput);
    const context = await createUiCommandContext();
    await discardActivityDraftWorkingCopy(getDatabaseClient(), context, {
      workingCopyId: input.workingCopyId,
      expectedVersion: null,
    });
    revalidatePath("/teacher/activities");
    if (input.draftId) revalidatePath(`/teacher/activities/${input.draftId}`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
