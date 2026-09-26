import "server-only";

import {
  storedDiagnosisFindingsSchema,
  type StoredDiagnosisFinding,
} from "../../domain/activity/draft-diagnosis";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

export type DraftDiagnosisView = Readonly<{
  id: string;
  revisionVersion: number;
  createdAt: string;
  summary: string;
  findings: readonly StoredDiagnosisFinding[];
}>;

/** Diagnoses of the teacher's own draft, newest first; others see nothing. */
export async function getDraftDiagnoses(
  database: PrismaClient,
  commandContext: CommandContext,
  draftId: string,
): Promise<DraftDiagnosisView[] | null> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const draft = await database.activityDraft.findUnique({
    where: { id: draftId },
    select: {
      ownerId: true,
      diagnoses: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: {
          id: true,
          summary: true,
          findings: true,
          createdAt: true,
          revision: { select: { version: true } },
        },
      },
    },
  });
  if (!draft || draft.ownerId !== context.actorId) return null;
  return draft.diagnoses.map((diagnosis) => ({
    id: diagnosis.id,
    revisionVersion: diagnosis.revision.version,
    createdAt: diagnosis.createdAt.toISOString(),
    summary: diagnosis.summary,
    findings: storedDiagnosisFindingsSchema.parse(diagnosis.findings),
  }));
}
