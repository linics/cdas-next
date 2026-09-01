import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { type PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "./command-context";
import { isActiveSchoolMember } from "../school/teacher-authorization";

const inputSchema = z.object({
  actionIntentId: z.uuid(),
  decision: z.enum(["CONFIRM", "REJECT"]),
}).strict();

export type DecideActionIntentInput = z.input<typeof inputSchema>;

export type DecideActionIntentResult = {
  actionIntentId: string;
  status: "CONFIRMED" | "REJECTED";
  decidedAt: Date;
};

export class DecideActionIntentError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "ACTION_EXPIRED"
      | "ALREADY_DECIDED"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "DecideActionIntentError";
  }
}

function hashDecision(
  actionIntentId: string,
  decision: "CONFIRM" | "REJECT",
  payloadHash: string | null,
) {
  const value = canonicalize({ actionIntentId, decision, payloadHash });
  if (value === undefined) {
    throw new TypeError("Action decision cannot be canonicalized");
  }
  return createHash("sha256").update(value).digest("hex");
}

export async function decideActionIntent(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: DecideActionIntentInput,
): Promise<DecideActionIntentResult> {
  const input = inputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const { now } = context;
  const desiredStatus: DecideActionIntentResult["status"] =
    input.decision === "CONFIRM" ? "CONFIRMED" : "REJECTED";

  const outcome = await database.$transaction(async (transaction) => {
    if (!(await isActiveSchoolMember(transaction, context.actorId))) {
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    const intent = await transaction.actionIntent.findUnique({
      where: { id: input.actionIntentId },
    });

    if (!intent) {
      await transaction.actionAudit.create({
        data: {
          actorId: context.actorId,
          source: context.source,
          actionName: "decide_action_intent",
          targetType: "ActionIntent",
          targetId: input.actionIntentId,
          requestHash: hashDecision(
            input.actionIntentId,
            input.decision,
            null,
          ),
          outcome: "DENIED",
          errorCode: "NOT_FOUND",
          traceId: context.traceId,
        },
      });
      return { ok: false as const, code: "NOT_FOUND" as const };
    }
    const requestHash = hashDecision(
      input.actionIntentId,
      input.decision,
      intent.payloadHash,
    );
    const auditBase = {
      actorId: context.actorId,
      agentRunId: intent.agentRunId,
      actionIntentId: intent.id,
      source: context.source,
      actionName: "decide_action_intent",
      targetType: "ActionIntent",
      targetId: intent.id,
      requestHash,
      traceId: context.traceId,
    } as const;

    if (intent.actorId !== context.actorId) {
      await transaction.actionAudit.create({
        data: {
          ...auditBase,
          outcome: "DENIED",
          errorCode: "FORBIDDEN",
        },
      });
      return { ok: false as const, code: "FORBIDDEN" as const };
    }

    if (
      intent.status === desiredStatus &&
      intent.decidedById === context.actorId &&
      intent.decidedAt
    ) {
      return {
        ok: true as const,
        value: {
          actionIntentId: intent.id,
          status: desiredStatus,
          decidedAt: intent.decidedAt,
        },
      };
    }

    if (intent.status !== "PREPARED") {
      await transaction.actionAudit.create({
        data: {
          ...auditBase,
          outcome: "CONFLICTED",
          errorCode: "ALREADY_DECIDED",
        },
      });
      return { ok: false as const, code: "ALREADY_DECIDED" as const };
    }

    if (intent.expiresAt <= now) {
      const expired = await transaction.actionIntent.updateMany({
        where: {
          id: intent.id,
          actorId: context.actorId,
          status: "PREPARED",
          expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
      });

      if (expired.count !== 1) {
        const current = await transaction.actionIntent.findUnique({
          where: { id: intent.id },
        });
        if (
          current?.status === desiredStatus &&
          current.decidedById === context.actorId &&
          current.decidedAt
        ) {
          return {
            ok: true as const,
            value: {
              actionIntentId: current.id,
              status: desiredStatus,
              decidedAt: current.decidedAt,
            },
          };
        }

        const code =
          current?.status === "PREPARED"
            ? ("CONCURRENT_WRITE" as const)
            : ("ALREADY_DECIDED" as const);
        await transaction.actionAudit.create({
          data: {
            ...auditBase,
            outcome: "CONFLICTED",
            errorCode: code,
          },
        });
        return { ok: false as const, code };
      }

      await transaction.actionAudit.create({
        data: {
          ...auditBase,
          outcome: "CONFLICTED",
          errorCode: "ACTION_EXPIRED",
        },
      });
      return { ok: false as const, code: "ACTION_EXPIRED" as const };
    }

    const updated = await transaction.actionIntent.updateMany({
      where: {
        id: intent.id,
        actorId: context.actorId,
        status: "PREPARED",
        expiresAt: { gt: now },
      },
      data: {
        status: desiredStatus,
        decidedById: context.actorId,
        decidedAt: now,
      },
    });

    if (updated.count !== 1) {
      const current = await transaction.actionIntent.findUnique({
        where: { id: intent.id },
      });
      if (
        current?.status === desiredStatus &&
        current.decidedById === context.actorId &&
        current.decidedAt
      ) {
        return {
          ok: true as const,
          value: {
            actionIntentId: current.id,
            status: desiredStatus,
            decidedAt: current.decidedAt,
          },
        };
      }

      const code =
        current?.status === "PREPARED"
          ? ("CONCURRENT_WRITE" as const)
          : ("ALREADY_DECIDED" as const);
      await transaction.actionAudit.create({
        data: {
          ...auditBase,
          outcome: "CONFLICTED",
          errorCode: code,
        },
      });
      return { ok: false as const, code };
    }

    await transaction.actionAudit.create({
      data: {
        ...auditBase,
        outcome: "SUCCEEDED",
      },
    });

    return {
      ok: true as const,
      value: {
        actionIntentId: intent.id,
        status: desiredStatus,
        decidedAt: now,
      },
    };
  });

  if (!outcome.ok) {
    throw new DecideActionIntentError(outcome.code);
  }
  return outcome.value;
}
