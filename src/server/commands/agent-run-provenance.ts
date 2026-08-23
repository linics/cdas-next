import type { Prisma } from "../../generated/prisma/client";
import type { ResolvedCommandContext } from "./command-context";

/**
 * Validate the product boundary between a human UI write and an Agent-assisted
 * write. A new Agent write must belong to the human actor and still be
 * RUNNING. Exact idempotent replays return before this check, so accepting a
 * completed run here would only permit unrelated new writes to reuse stale
 * provenance.
 */
export async function hasValidAgentRunProvenance(
  transaction: Prisma.TransactionClient,
  context: Pick<ResolvedCommandContext, "actorId" | "source">,
  agentRunId: string | null,
): Promise<boolean> {
  if (context.source === "UI") {
    return agentRunId === null;
  }

  if (context.source !== "AGENT" || agentRunId === null) {
    return false;
  }

  const agentRun = await transaction.agentRun.findUnique({
    where: { id: agentRunId },
    select: { actorId: true, status: true },
  });

  return (
    agentRun?.actorId === context.actorId &&
    agentRun.status === "RUNNING"
  );
}
