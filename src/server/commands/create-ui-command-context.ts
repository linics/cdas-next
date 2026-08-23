import "server-only";

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { getCurrentActor } from "../auth/current-actor";
import type { CommandContext } from "./command-context";

export async function createUiCommandContext(
  database?: PrismaClient,
): Promise<CommandContext> {
  const actor = await getCurrentActor(database);
  return {
    actorId: actor.id,
    source: "UI",
    traceId: randomUUID(),
    clock: () => new Date(),
  };
}
