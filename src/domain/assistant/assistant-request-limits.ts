/**
 * What one assistant request may carry. The server refuses anything larger;
 * the panel checks the same numbers before sending so a long
 * conversation offers a fresh one instead of failing (D-099).
 */
export const assistantRequestLimits = {
  // One design turn carries about 41 KB (two searches, three standard
  // sections, the proposal) and each revision turn about 16–20 KB (the draft
  // read back plus the edits). At 64 KB the confirmation of the first revision
  // after a design was already refused (2026-10-14).
  maxRequestBytes: 128 * 1024,
  maxMessages: 16,
  maxUserText: 4_000,
  maxHistoryText: 20_000,
  maxToolParts: 24,
} as const;

/**
 * Room the panel keeps for the reply to the message it is about to send. A
 * confirmation card goes back with the whole history, reply included; without
 * this the teacher's message fits but the card it brings cannot be confirmed.
 */
export const assistantReplyReserve = {
  bytes: 24 * 1024,
  toolParts: 8,
} as const;

type MessageLike = Readonly<{
  role: string;
  parts: ReadonlyArray<Readonly<{ type: string; text?: string }>>;
}>;

/**
 * Whether the history plus one more user message, and the reply it may bring,
 * stays within the limits. The byte count is of the request body the panel
 * would send; the server remains the judge, this only avoids a request (or a
 * confirmation) that is bound to fail.
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
  if (
    text > assistantRequestLimits.maxHistoryText ||
    toolParts + assistantReplyReserve.toolParts > assistantRequestLimits.maxToolParts
  ) {
    return false;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(body(all))).byteLength;
  return bytes + assistantReplyReserve.bytes <= assistantRequestLimits.maxRequestBytes;
}
