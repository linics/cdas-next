import { createClerkClient } from "@clerk/nextjs/server";
import { issueAgentTicket, type AgentTicketRole } from "./ticket";
import { assertAgentBrowserPrerequisites } from "./prerequisites";
async function main(){await assertAgentBrowserPrerequisites(process.env);const role=(process.argv[2]??"TEACHER") as AgentTicketRole;const clerk=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY,publishableKey:process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,telemetry:{disabled:true}});process.stdout.write(await issueAgentTicket(process.env,role,clerk));}
void main().catch(()=>{process.exitCode=1;});
