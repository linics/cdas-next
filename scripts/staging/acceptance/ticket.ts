import { evaluateAcceptanceReadiness, type AcceptanceEnvironment } from "./contracts";

export type AcceptanceTicketRole = "TEACHER" | "STUDENT" | "OTHER_STUDENT";
export type ClerkTicketClient = Readonly<{
  signInTokens: Readonly<{
    createSignInToken(input: Readonly<{ userId: string; expiresInSeconds: number }>): Promise<Readonly<{ token?: string | null }>>;
  }>;
}>;

export async function issueAcceptanceTicket(
  environment: AcceptanceEnvironment,
  role: AcceptanceTicketRole,
  client: ClerkTicketClient,
): Promise<string> {
  if (role !== "TEACHER" && role !== "STUDENT" && role !== "OTHER_STUDENT") throw new Error("STAGING_ACCEPTANCE_TICKET_ROLE_INVALID");
  if (evaluateAcceptanceReadiness(environment).status !== "PASS") throw new Error("STAGING_ACCEPTANCE_READINESS_FAILED");
  const subjectName = { TEACHER: "STAGING_TEST_TEACHER_CLERK_ID", STUDENT: "STAGING_TEST_STUDENT_CLERK_ID", OTHER_STUDENT: "STAGING_TEST_OTHER_STUDENT_CLERK_ID" } as const;
  const userId = environment[subjectName[role]]?.trim();
  if (!userId) throw new Error("STAGING_ACCEPTANCE_TICKET_SUBJECT_MISSING");
  const result = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 });
  if (!result.token || typeof result.token !== "string") throw new Error("STAGING_ACCEPTANCE_TICKET_INVALID_RESPONSE");
  return result.token;
}
