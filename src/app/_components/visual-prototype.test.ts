import { describe, expect, it } from "vitest";
import {
  parseVisualPrototype,
  readVisualPrototype,
} from "./visual-prototype";

describe("visual prototype query", () => {
  it("accepts only the three reviewable directions", () => {
    expect(parseVisualPrototype("warm-paper")).toBe("warm-paper");
    expect(parseVisualPrototype("ink-structure")).toBe("ink-structure");
    expect(parseVisualPrototype("soft-studio")).toBe("soft-studio");
    expect(parseVisualPrototype("glass")).toBeUndefined();
    expect(parseVisualPrototype(["warm-paper", "ink-structure"])).toBe(
      "warm-paper",
    );
  });

  it("reads the visual search param from a Next.js promise", async () => {
    await expect(readVisualPrototype()).resolves.toBeUndefined();
    await expect(
      readVisualPrototype(Promise.resolve({ visual: "soft-studio" })),
    ).resolves.toBe("soft-studio");
    await expect(
      readVisualPrototype(Promise.resolve({ visual: "unknown" })),
    ).resolves.toBeUndefined();
  });
});
