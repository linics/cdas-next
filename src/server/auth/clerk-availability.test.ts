import { describe, expect, it } from "vitest";
import { isClerkAuthenticationAvailable } from "./clerk-availability";

describe("isClerkAuthenticationAvailable", () => {
  it("uses Clerk's keyless mode during local development", () => {
    expect(isClerkAuthenticationAvailable({ NODE_ENV: "development" })).toBe(
      true,
    );
  });

  it("does not enable keyless mode outside development", () => {
    expect(isClerkAuthenticationAvailable({ NODE_ENV: "production" })).toBe(
      false,
    );
  });

  it("respects the keyless opt-out", () => {
    expect(
      isClerkAuthenticationAvailable({
        NODE_ENV: "development",
        NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: "true",
      }),
    ).toBe(false);
  });

  it("accepts explicitly configured keys in every environment", () => {
    expect(
      isClerkAuthenticationAvailable({
        NODE_ENV: "production",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
        CLERK_SECRET_KEY: "sk_test_example",
      }),
    ).toBe(true);
  });
});
