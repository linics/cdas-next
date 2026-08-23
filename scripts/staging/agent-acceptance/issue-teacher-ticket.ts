import { createClerkClient } from "@clerk/nextjs/server";
import { issueAgentTeacherTicket } from "./ticket";
import { assertAgentBrowserPrerequisites } from "./prerequisites";
async function main(){await assertAgentBrowserPrerequisites(process.env);const clerk=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY,publishableKey:process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,telemetry:{disabled:true}});process.stdout.write(await issueAgentTeacherTicket(process.env,clerk));}
void main().catch(()=>{process.exitCode=1;});
