/**
 * What one assistant request may carry. The server refuses anything larger;
 * the panel checks the same numbers before sending so a long
 * conversation offers a fresh one instead of failing (D-099).
 */
export const assistantRequestLimits = {
  maxRequestBytes: 64 * 1024,
  maxMessages: 16,
  maxUserText: 4_000,
  maxHistoryText: 20_000,
  maxToolParts: 24,
} as const;

type MessageLike = Readonly<{
  role: string;
  parts: ReadonlyArray<Readonly<{ type: string; text?: string }>>;
}>;

/**
 * Whether the history plus one more user message stays within the limits.
 * The byte count is of the request body the panel would send; the server
 * remains the judge, this only avoids a request that is bound to fail.
 */
export function assistantHistoryHasRoom(
  messages: readonly MessageLike[],
  nextUserText: string,
  body: (messages: readonly MessageLike[]) => unknown = (all) => ({ messages: all }),
): boolean {
  const next: MessageLike = { role: "user", parts: [{ type: "text", text: nextUserText }] };
  const all = [...messages, next];
  if (all.length > assistantRequestLimits.maxMessages) return false;
  let text = 0;
  let toolParts = 0;
  for (const message of all) {
    for (const part of message.parts) {
      if (part.type === "text") text += part.text?.length ?? 0;
      else if (part.type.startsWith("tool-")) toolParts += 1;
    }
  }
  if (text > assistantRequestLimits.maxHistoryText || toolParts > assistantRequestLimits.maxToolParts) {
    return false;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(body(all))).byteLength;
  return bytes <= assistantRequestLimits.maxRequestBytes;
}
