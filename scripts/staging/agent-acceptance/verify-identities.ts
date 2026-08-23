import { createClerkClient } from "@clerk/nextjs/server";
import { stableAgentAcceptanceError } from "./contracts";
import { verifyAgentIdentities } from "./identity";
import { writeAgentArtifact } from "./output";
import { assertAgentIdentityPrerequisites } from "./prerequisites";
async function main(){await assertAgentIdentityPrerequisites(process.env);const marker=process.env.STAGING_RUN_MARKER?.trim()??"";const clerk=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY,publishableKey:process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,telemetry:{disabled:true}});const checks=await verifyAgentIdentities(process.env,clerk);await writeAgentArtifact(marker,"identity.json",{schema:"staging-agent-acceptance-identity.v1",status:"PASS",checks,ticketsRevoked:true,realStudentDataAllowed:false,productionDecision:"NO_GO"});process.stdout.write('{"schema":"staging-agent-acceptance-identity.v1","status":"PASS"}\n');}
void main().catch(async error=>{try{await writeAgentArtifact(process.env.STAGING_RUN_MARKER?.trim()??"","identity.json",{schema:"staging-agent-acceptance-identity.v1",status:"FAIL",checks:[{code:stableAgentAcceptanceError(error),status:"FAIL"}],ticketsRevoked:false,realStudentDataAllowed:false,productionDecision:"NO_GO"});}catch{} process.stdout.write('{"schema":"staging-agent-acceptance-identity.v1","status":"FAIL"}\n');process.exitCode=1;});
