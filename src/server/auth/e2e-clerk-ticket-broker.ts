import "server-only";

import { timingSafeEqual } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";

const roleSchema = z.enum(["TEACHER", "STUDENT"]);
const clerkUserIdSchema = z.string().regex(/^user_[A-Za-z0-9]+$/u);
const runMarkerPattern = /^cdas-e2e-[a-z0-9-]{8,80}$/u;

type BrokerEnvironment = Readonly<Record<string, string | undefined>>;

type BrokerDependencies = Readonly<{
  createTicket: (userId: string) => Promise<string>;
}>;

export type E2eClerkTicketResult =
  | Readonly<{
      ok: true;
      ticket: string;
      returnPath: "/teacher" | "/student";
    }>
  | Readonly<{ ok: false; status: 404 | 503 }>;

const defaultDependencies: BrokerDependencies = {
  createTicket: async (userId) => {
    const client = await clerkClient();
    const signInToken = await client.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: 60,
    });
    return signInToken.token;
  },
};

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided || provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function issueE2eClerkTicket(
  rawRole: string | null,
  providedSecret: string | null,
  environment: BrokerEnvironment = process.env,
  dependencies: BrokerDependencies = defaultDependencies,
): Promise<E2eClerkTicketResult> {
  const expectedSecret = environment.E2E_CLERK_TICKET_SECRET ?? "";
  const runMarker = environment.E2E_RUN_MARKER ?? "";
  if (
    environment.NODE_ENV !== "development" ||
    expectedSecret.length < 32 ||
    !runMarkerPattern.test(runMarker) ||
    !secretsMatch(providedSecret, expectedSecret) ||
    environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_") ||
    environment.CLERK_SECRET_KEY?.startsWith("sk_live_")
  ) {
    return { ok: false, status: 404 };
  }

  const parsedRole = roleSchema.safeParse(rawRole);
  if (!parsedRole.success) {
    return { ok: false, status: 404 };
  }
  const parsedUserId = clerkUserIdSchema.safeParse(
    parsedRole.data === "TEACHER"
      ? environment.DEV_TEST_TEACHER_CLERK_ID
      : environment.DEV_TEST_STUDENT_CLERK_ID,
  );
  if (!parsedUserId.success) {
    return { ok: false, status: 404 };
  }

  try {
    const ticket = await dependencies.createTicket(parsedUserId.data);
    if (!ticket) {
      return { ok: false, status: 503 };
    }
    return {
      ok: true,
      ticket,
      returnPath: parsedRole.data === "TEACHER" ? "/teacher" : "/student",
    };
  } catch {
    return { ok: false, status: 503 };
  }
}
