"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  ActivitySourceReferenceError,
  withdrawActivitySource,
} from "../../../../server/commands/activity-source-references";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";

export async function withdrawSourceAction(formData: FormData) {
  const input = z
    .object({ draftId: z.uuid(), referenceId: z.uuid() })
    .safeParse({
      draftId: formData.get("draftId"),
      referenceId: formData.get("referenceId"),
    });
  if (!input.success) return;
  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    await withdrawActivitySource(database, context, {
      referenceId: input.data.referenceId,
    });
  } catch (error) {
    // A sealed or foreign draft simply keeps its list; the page re-renders the
    // current truth either way.
    if (!(error instanceof ActivitySourceReferenceError)) throw error;
  }
  // Same path plus a hash is a client-side scroll; without this the page
  // would keep showing the pre-action render.
  revalidatePath(`/teacher/activities/${input.data.draftId}`);
  redirect(`/teacher/activities/${input.data.draftId}#source-references`);
}
