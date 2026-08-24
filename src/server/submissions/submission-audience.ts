import "server-only";

import { Prisma } from "../../generated/prisma/client";

/**
 * The client never chooses a group. A current student resolves to their only
 * group for this release, or to their personal submission subject.
 */
export type SubmissionAudience =
  | { kind: "PERSONAL"; studentId: string }
  | { kind: "GROUP"; groupId: string };

export async function resolveSubmissionAudience(
  transaction: Prisma.TransactionClient,
  releaseId: string,
  actorId: string,
): Promise<SubmissionAudience> {
  const membership = await transaction.releaseGroupMember.findFirst({
    where: {
      studentId: actorId,
      group: { releaseId },
    },
    select: { groupId: true },
  });

  return membership
    ? { kind: "GROUP", groupId: membership.groupId }
    : { kind: "PERSONAL", studentId: actorId };
}

export function submissionAudienceWhere(
  releaseId: string,
  audience: SubmissionAudience,
): Prisma.SubmissionWhereInput {
  return audience.kind === "GROUP"
    ? { releaseId, groupId: audience.groupId }
    : { releaseId, studentId: audience.studentId };
}

export function submissionAudiencePhaseWhere(
  releaseId: string,
  phaseIndex: number,
  audience: SubmissionAudience,
): Prisma.SubmissionWhereInput {
  return { ...submissionAudienceWhere(releaseId, audience), phaseIndex };
}

export function submissionAudienceData(
  audience: SubmissionAudience,
): { studentId: string | null; groupId: string | null } {
  return audience.kind === "GROUP"
    ? { studentId: null, groupId: audience.groupId }
    : { studentId: audience.studentId, groupId: null };
}

export function isSubmissionAudienceMemberWhere(
  actorId: string,
): Prisma.SubmissionWhereInput {
  return {
    OR: [
      { studentId: actorId },
      { group: { members: { some: { studentId: actorId } } } },
    ],
  };
}
