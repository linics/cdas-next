import "server-only";

import { Prisma } from "../../generated/prisma/client";

/**
 * The retry policy every serializable command shares.
 *
 * Sixteen commands each kept their own copy of `attempt <= 3`, the same pair of
 * Prisma codes, and an immediate `continue`. One copy of the policy means a
 * change to it cannot land in fifteen places and miss the sixteenth.
 */
export const serializableRetryAttempts = 3;

/**
 * Postgres refused to serialize this transaction. Always someone else getting
 * there first, never a wrong request.
 */
export function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

/**
 * The same, plus the unique violation a racing idempotency-key insert raises:
 * the winner stored the response first, and the next attempt should re-read it
 * rather than report a constraint violation.
 *
 * Ten commands use this. Six others write an idempotency record too and still
 * only retry `isSerializationFailure` — they predate this module and are left
 * exactly as they were, because widening what a command retries is a behaviour
 * change and this one is meant to add a delay, nothing else. Whether those six
 * should widen is an open question with a real answer either way; it wants its
 * own reasoning and its own test, not a rename.
 */
export function isRetryableSerializationError(error: unknown): boolean {
  return (
    isSerializationFailure(error) ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002")
  );
}

/**
 * Wait before the next attempt, a little longer each time and never the same
 * amount twice.
 *
 * Two identical requests arriving together fail together: Postgres aborts one
 * for serialization, and the loser's whole job is then to re-read what the
 * winner committed. Retrying immediately asks the question before the winner
 * has had a chance to answer it, and — because both sides retry at the same
 * instant — keeps them in step for the next collision too. Measured locally,
 * every such conflict is P2034 and every one recovers on the following attempt,
 * so the loop gives up while still holding the cheapest option it has: waiting.
 *
 * The jitter is the part that breaks the lockstep; the growth is what buys a
 * slow commit time to land. Worst case this adds well under a tenth of a second
 * to a request that was going to fail outright.
 */
export function serializableRetryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  return attempt * 20 + Math.floor(random() * 25);
}

export async function waitBeforeSerializableRetry(
  attempt: number,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  await sleep(serializableRetryDelayMs(attempt));
}
