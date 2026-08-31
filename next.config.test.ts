import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("student roster upload server action", () => {
  it("leaves request-envelope room around the two-megabyte roster file limit", () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("3mb");
  });
});
