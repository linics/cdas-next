import "server-only";

import type { Prisma } from "../../generated/prisma/client";
import type { ResolvedCommandContext } from "./command-context";

/**
 * Close the provenance gap between an Agent business write and the AgentRun
 * that owns it. This helper must be called inside the same transaction as the
 * immutable business result and its success audit.
 *
 * UI writes may not carry an AgentRun. AGENT writes atomically compare and set
 * the actor-owned RUNNING row to SUCCEEDED, while an exact prior success is an
 * idempotent replay. Failed, cancelled, incomplete, or foreign runs fail
 * closed so the surrounding business transaction can roll back.
 */
export async function completeAgentRunBusinessWrite(
  transaction: Prisma.TransactionClient,
  context: Pick<ResolvedCommandContext, "actorId" | "source" | "now">,
  agentRunId: string | null,
  options: { allowAlreadySucceeded?: boolean } = {},
): Promise<boolean> {
  if (context.source === "UI") {
    return agentRunId === null;
  }
  if (context.source !== "AGENT" || agentRunId === null) {
    return false;
  }

  const updated = await transaction.agentRun.updateMany({
    where: {
      id: agentRunId,
      actorId: context.actorId,
      status: "RUNNING",
    },
    data: {
      status: "SUCCEEDED",
      completedAt: context.now,
      failureCode: null,
    },
  });
  if (updated.count === 1) {
    return true;
  }

  if (!options.allowAlreadySucceeded) {
    return false;
  }

  const current = await transaction.agentRun.findUnique({
    where: { id: agentRunId },
    select: {
      actorId: true,
      status: true,
      completedAt: true,
      failureCode: true,
    },
  });
  return (
    current?.actorId === context.actorId &&
    current.status === "SUCCEEDED" &&
    current.completedAt !== null &&
    current.failureCode === null
  );
}
