import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentAcceptanceEnvironment } from "./contracts";
import { isAgentGate } from "./gate";
import { agentOutputDirectory } from "./output";
const read = async (e:AgentAcceptanceEnvironment,name:string) => JSON.parse(await readFile(path.join(agentOutputDirectory(e.STAGING_RUN_MARKER?.trim() ?? ""),name),"utf8")) as unknown;
const passing=(value:unknown,schema:string)=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)&&(value as Record<string,unknown>).schema===schema&&(value as Record<string,unknown>).status==="PASS";
export async function assertAgentIdentityPrerequisites(e:AgentAcceptanceEnvironment){if(!isAgentGate(await read(e,"gate.json"),e))throw new Error("STAGING_AGENT_ACCEPTANCE_GATE_NOT_GO");}
export async function assertAgentBootstrapPrerequisites(e:AgentAcceptanceEnvironment){await assertAgentIdentityPrerequisites(e); if(!passing(await read(e,"identity.json"),"staging-agent-acceptance-identity.v1")||!passing(await read(e,"immediate-health.json"),"staging-agent-acceptance-immediate-health.v1"))throw new Error("STAGING_AGENT_ACCEPTANCE_PREWRITE_NOT_GO");}
export async function assertAgentBrowserPrerequisites(e:AgentAcceptanceEnvironment){await assertAgentBootstrapPrerequisites(e);if(!passing(await read(e,"bootstrap.json"),"staging-agent-acceptance-bootstrap.v1"))throw new Error("STAGING_AGENT_ACCEPTANCE_BOOTSTRAP_NOT_GO");}
