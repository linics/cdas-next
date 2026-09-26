import "server-only";

import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import { officialKnowledgeFingerprint } from "../knowledge/official-corpus";

export type ActivitySourceReferenceView = Readonly<{
  id: string;
  origin: "AGENT_PROPOSAL" | "TEACHER_SELECTION";
  citationLabel: string;
  rationale: string;
  adoptedAtVersion: number;
  adoptedAt: string;
  withdrawnAt: string | null;
  /**
   * MATCH: today's corpus still holds the adopted text. CHANGED: the section
   * exists but its text differs. MISSING: the section is gone. Only MATCH may
   * be presented as the text that was adopted (D-067).
   */
  corpusStatus: "MATCH" | "CHANGED" | "MISSING";
  href: string | null;
  contentHash: string;
}>;

/**
 * References adopted for the teacher's own draft, oldest first. Another
 * teacher's draft is simply absent, matching the draft page's own boundary.
 */
export async function getActivitySourceReferences(
  database: PrismaClient,
  commandContext: CommandContext,
  draftId: string,
): Promise<{ currentVersion: number; references: ActivitySourceReferenceView[] } | null> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const draft = await database.activityDraft.findUnique({
    where: { id: draftId },
    select: {
      ownerId: true,
      version: true,
      sourceReferences: {
        orderBy: [
          { createdAt: "asc" },
          { revision: { version: "asc" } },
          { id: "asc" },
        ],
        select: {
          id: true,
          origin: true,
          sourceId: true,
          sectionId: true,
          contentHash: true,
          citationLabel: true,
          rationale: true,
          createdAt: true,
          revision: { select: { version: true } },
          withdrawal: { select: { createdAt: true } },
        },
      },
    },
  });
  if (!draft || draft.ownerId !== context.actorId) return null;

  return {
    currentVersion: draft.version,
    references: draft.sourceReferences.map((reference) => {
      const current = officialKnowledgeFingerprint(
        reference.sourceId,
        reference.sectionId,
      );
      const corpusStatus = !current
        ? "MISSING"
        : current.contentHash === reference.contentHash
          ? "MATCH"
          : "CHANGED";
      return {
        id: reference.id,
        origin: reference.origin,
        citationLabel: reference.citationLabel,
        rationale: reference.rationale,
        adoptedAtVersion: reference.revision.version,
        adoptedAt: reference.createdAt.toISOString(),
        withdrawnAt: reference.withdrawal?.createdAt.toISOString() ?? null,
        corpusStatus,
        href: current
          ? `/teacher/knowledge?source=${reference.sourceId}&section=${reference.sectionId}`
          : null,
        contentHash: reference.contentHash,
      };
    }),
  };
}

/** The teacher's own open v3 drafts a section could be adopted into. */
export async function getAdoptableDrafts(
  database: PrismaClient,
  commandContext: CommandContext,
) {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const drafts = await database.activityDraft.findMany({
    where: {
      ownerId: context.actorId,
      schemaVersion: 3,
      status: { not: "SEALED" },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 50,
    select: { id: true, title: true, version: true },
  });
  return drafts;
}
