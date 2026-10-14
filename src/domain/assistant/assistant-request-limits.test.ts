import { describe, expect, it } from "vitest";
import { assistantHistoryHasRoom, assistantReplyReserve, assistantRequestLimits } from "./assistant-request-limits";

function turn(index: number, text = "一句话") {
  return [
    { role: "user", parts: [{ type: "text", text: `${text}${index}` }] },
    { role: "assistant", parts: [{ type: "text", text: "好的。" }] },
  ];
}

describe("assistantHistoryHasRoom (D-099)", () => {
  it("allows a next message while every limit holds", () => {
    expect(assistantHistoryHasRoom([], "第一句")).toBe(true);
    expect(assistantHistoryHasRoom([...turn(1), ...turn(2)], "第三句")).toBe(true);
  });

  it("stops at the message count the server accepts", () => {
    const fifteen = Array.from({ length: 8 }, (_, index) => turn(index)).flat().slice(0, 15);
    expect(fifteen).toHaveLength(15);
    expect(assistantHistoryHasRoom(fifteen, "下一句")).toBe(true);
    expect(assistantHistoryHasRoom([...fifteen, { role: "assistant", parts: [{ type: "text", text: "x" }] }], "下一句")).toBe(false);
  });

  it("stops when the text, the tool parts or the bytes would be too many", () => {
    const longText = "字".repeat(assistantRequestLimits.maxHistoryText);
    expect(assistantHistoryHasRoom(turn(1, longText), "再来")).toBe(false);

    const tools = [
      { role: "user", parts: [{ type: "text", text: "查" }] },
      { role: "assistant", parts: Array.from({ length: assistantRequestLimits.maxToolParts + 1 }, () => ({ type: "tool-get_current_context" })) },
    ];
    expect(assistantHistoryHasRoom(tools, "再来")).toBe(false);

    const bulky = (all: readonly unknown[]) => ({ messages: all, padding: "x".repeat(assistantRequestLimits.maxRequestBytes) });
    expect(assistantHistoryHasRoom(turn(1), "再来", bulky)).toBe(false);
  });

  it("keeps room for the reply, so the card it brings can still be confirmed", () => {
    const padded = (size: number) => (all: readonly unknown[]) => ({ messages: all, padding: "x".repeat(size) });
    const nearlyFull = assistantRequestLimits.maxRequestBytes - assistantReplyReserve.bytes / 2;
    expect(assistantHistoryHasRoom(turn(1), "再来", padded(nearlyFull))).toBe(false);
    const roomy = assistantRequestLimits.maxRequestBytes - assistantReplyReserve.bytes * 2;
    expect(assistantHistoryHasRoom(turn(1), "再来", padded(roomy))).toBe(true);

    const toolsUpTo = (count: number) => [
      { role: "user", parts: [{ type: "text", text: "查" }] },
      { role: "assistant", parts: Array.from({ length: count }, () => ({ type: "tool-get_current_context" })) },
    ];
    const lastThatFits = assistantRequestLimits.maxToolParts - assistantReplyReserve.toolParts;
    expect(assistantHistoryHasRoom(toolsUpTo(lastThatFits), "再来")).toBe(true);
    expect(assistantHistoryHasRoom(toolsUpTo(lastThatFits + 1), "再来")).toBe(false);
  });

  it("fits a design turn followed by a revision turn (2026-10-14 sizes)", () => {
    // A real design turn was 41 KB and its revision turn 18 KB.
    const measured = (all: readonly unknown[]) => ({ messages: all, padding: "x".repeat(59 * 1024) });
    expect(assistantHistoryHasRoom(turn(1), "继续", measured)).toBe(true);
  });
});
