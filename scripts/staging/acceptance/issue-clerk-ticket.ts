import { createClerkClient } from "@clerk/nextjs/server";

import { stableAcceptanceErrorCode } from "./contracts";
import { assertBrowserPrerequisites } from "./prerequisites";
import { issueAcceptanceTicket, type AcceptanceTicketRole } from "./ticket";

function roleFromArguments(args: readonly string[]): AcceptanceTicketRole {
  if (args.length !== 1 || (args[0] !== "TEACHER" && args[0] !== "STUDENT" && args[0] !== "OTHER_STUDENT" && args[0] !== "OTHER_TEACHER")) throw new Error("STAGING_ACCEPTANCE_TICKET_ROLE_INVALID");
  return args[0];
}

async function main(): Promise<void> {
  const role = roleFromArguments(process.argv.slice(2));
  await assertBrowserPrerequisites(process.env);
  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    telemetry: { disabled: true },
  });
  const ticket = await issueAcceptanceTicket(process.env, role, clerk);
  // This process is called with captured stdout only. Never add JSON/logging here:
  // its only successful output is the short-lived ticket held by the browser runner.
  process.stdout.write(ticket);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${stableAcceptanceErrorCode(error)}\n`);
  process.exitCode = 1;
});
