import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));

import { issueE2eClerkTicket } from "./e2e-clerk-ticket-broker";

const brokerSecret = "e2e-broker-secret-that-is-longer-than-32-bytes";
const createTicket = vi.fn();

describe("issueE2eClerkTicket", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("E2E_RUN_MARKER", "cdas-e2e-20260823000000-test01");
    vi.stubEnv("E2E_CLERK_TICKET_SECRET", brokerSecret);
    vi.stubEnv("DEV_TEST_TEACHER_CLERK_ID", "user_teacher123");
    vi.stubEnv("DEV_TEST_STUDENT_CLERK_ID", "user_student123");
    createTicket.mockResolvedValue("short-lived-ticket");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("issues one short-lived real Clerk ticket after ephemeral-secret authentication", async () => {
    await expect(
      issueE2eClerkTicket("TEACHER", brokerSecret, process.env, {
        createTicket,
      }),
    ).resolves.toEqual({
      ok: true,
      ticket: "short-lived-ticket",
      returnPath: "/teacher",
    });
    expect(createTicket).toHaveBeenCalledWith("user_teacher123");
  });

  it.each([
    ["wrong-secret", "TEACHER"],
    [brokerSecret, "ADMIN"],
    [null, "STUDENT"],
  ])("returns not-found without contacting Clerk for an invalid broker request", async (secret, role) => {
    await expect(
      issueE2eClerkTicket(role, secret, process.env, { createTicket }),
    ).resolves.toEqual({ ok: false, status: 404 });
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("does not exist in production or with production Clerk keys", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(
      issueE2eClerkTicket("TEACHER", brokerSecret, process.env, {
        createTicket,
      }),
    ).resolves.toEqual({ ok: false, status: 404 });

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_forbidden");
    await expect(
      issueE2eClerkTicket("TEACHER", brokerSecret, process.env, {
        createTicket,
      }),
    ).resolves.toEqual({ ok: false, status: 404 });
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("returns a stable unavailable result without exposing Clerk errors", async () => {
    createTicket.mockRejectedValue(new Error("private Clerk detail"));
    await expect(
      issueE2eClerkTicket("STUDENT", brokerSecret, process.env, {
        createTicket,
      }),
    ).resolves.toEqual({ ok: false, status: 503 });
  });
});
