import { z } from "zod";

export type CommandSource = "UI" | "AGENT" | "SYSTEM";

/**
 * Trusted request facts created by a server entry point. This object is kept
 * separate from form/tool input so callers cannot submit another actor, forge
 * the invocation source, or roll back the command clock.
 */
export type CommandContext = Readonly<{
  actorId: string;
  source: CommandSource;
  traceId: string;
  clock: () => Date;
}>;

const contextFactsSchema = z.object({
  actorId: z.uuid(),
  source: z.enum(["UI", "AGENT", "SYSTEM"]),
  traceId: z.string().trim().min(1).max(200),
});

export type ResolvedCommandContext = z.infer<typeof contextFactsSchema> & {
  now: Date;
};

export function resolveCommandContext(
  context: CommandContext,
  allowedSources: readonly CommandSource[],
): ResolvedCommandContext {
  const facts = contextFactsSchema.parse(context);
  if (!allowedSources.includes(facts.source)) {
    throw new TypeError(`Command source ${facts.source} is not allowed`);
  }

  const currentTime = context.clock();
  if (
    !(currentTime instanceof Date) ||
    Number.isNaN(currentTime.getTime())
  ) {
    throw new TypeError("Command clock returned an invalid date");
  }

  return { ...facts, now: new Date(currentTime.getTime()) };
}
