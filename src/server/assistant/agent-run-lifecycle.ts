import "server-only";

import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

const startInputSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
  })
  .strict();

const finishInputSchema = z
  .object({
    agentRunId: z.uuid(),
    status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
    failureCode: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Z0-9_]+$/)
      .nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "SUCCEEDED" && input.failureCode !== null) {
      context.addIssue({
        code: "custom",
        message: "A successful AgentRun cannot have a failure code",
        path: ["failureCode"],
      });
    }
    if (input.status !== "SUCCEEDED" && input.failureCode === null) {
      context.addIssue({
        code: "custom",
        message: "A failed or cancelled AgentRun needs a failure code",
        path: ["failureCode"],
      });
    }
  });

export class AgentRunLifecycleError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "ALREADY_FINISHED"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "AgentRunLifecycleError";
  }
}

export type StartedAgentRun = Readonly<{
  id: string;
  actorId: string;
  status: "RUNNING";
  model: string;
  startedAt: string;
}>;

export type FinishedAgentRun = Readonly<{
  id: string;
  actorId: string;
  status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  completedAt: string;
  failureCode: string | null;
}>;

/**
 * Create truthful provenance only for an authenticated teacher. This write is
 * intentionally completed before any model request and does not wrap a model
 * call or tool execution in a database transaction.
 */
export async function startActivityAssistantRun(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: z.input<typeof startInputSchema>,
): Promise<StartedAgentRun> {
  const input = startInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const actor = await database.appUser.findUnique({
    where: { id: context.actorId },
    select: { role: true },
  });

  if (!actor) {
    throw new AgentRunLifecycleError("NOT_FOUND");
  }
  if (actor.role !== "TEACHER") {
    throw new AgentRunLifecycleError("FORBIDDEN");
  }

  const run = await database.agentRun.create({
    data: {
      actorId: context.actorId,
      status: "RUNNING",
      model: input.model,
      startedAt: context.now,
    },
    select: {
      id: true,
      actorId: true,
      status: true,
      model: true,
      startedAt: true,
    },
  });

  return {
    ...run,
    status: "RUNNING",
    startedAt: run.startedAt.toISOString(),
  };
}

/**
 * Terminal state is a compare-and-set from RUNNING. A callback may safely
 * repeat the same terminal result, but it cannot rewrite a different result or
 * finish another actor's run.
 */
export async function finishActivityAssistantRun(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: z.input<typeof finishInputSchema>,
): Promise<FinishedAgentRun> {
  const input = finishInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["AGENT"]);
  const updated = await database.agentRun.updateMany({
    where: {
      id: input.agentRunId,
      actorId: context.actorId,
      status: "RUNNING",
    },
    data: {
      status: input.status,
      completedAt: context.now,
      failureCode: input.failureCode,
    },
  });

  if (updated.count === 1) {
    return {
      id: input.agentRunId,
      actorId: context.actorId,
      status: input.status,
      completedAt: context.now.toISOString(),
      failureCode: input.failureCode,
    };
  }

  const current = await database.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: {
      actorId: true,
      status: true,
      completedAt: true,
      failureCode: true,
    },
  });
  if (!current || current.actorId !== context.actorId) {
    throw new AgentRunLifecycleError("NOT_FOUND");
  }
  if (
    current.status === input.status &&
    current.failureCode === input.failureCode &&
    current.completedAt
  ) {
    return {
      id: input.agentRunId,
      actorId: context.actorId,
      status: input.status,
      completedAt: current.completedAt.toISOString(),
      failureCode: current.failureCode,
    };
  }

  throw new AgentRunLifecycleError(
    current.status === "RUNNING" ? "CONCURRENT_WRITE" : "ALREADY_FINISHED",
  );
}
