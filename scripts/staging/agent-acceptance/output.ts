import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentAcceptanceNamespace } from "./contracts";

const root = path.resolve(process.cwd(), "output", "staging-agent-acceptance");
export const agentArtifactNames = ["readiness.json", "gate.json", "identity.json", "immediate-health.json", "bootstrap.json", "browser.json", "cleanup.json", "verify.json", "final.json"] as const;
const allowed = new Set<string>(agentArtifactNames);
export function agentOutputDirectory(marker: string) { agentAcceptanceNamespace(marker); const dir = path.resolve(root, marker); if (!dir.startsWith(`${root}${path.sep}`)) throw new Error("STAGING_AGENT_ACCEPTANCE_OUTPUT_PATH_INVALID"); return dir; }
export async function writeAgentArtifact(marker: string, name: typeof agentArtifactNames[number], value: unknown) { if (!allowed.has(name)) throw new Error("STAGING_AGENT_ACCEPTANCE_ARTIFACT_INVALID"); const dir = agentOutputDirectory(marker); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
export type AgentScreenshotName =
  | "01-draft-proposal.png"
  | "02-draft-preview.png"
  | "03-publish-approval.png"
  | "04-published.png"
  | "05-student-submitted.png"
  | "06-teacher-feedback.png"
  | "07-teacher-closed.png"
  | "08-student-closed-readonly.png";
export function agentScreenshotPath(marker: string, name: AgentScreenshotName) { return path.join(agentOutputDirectory(marker), name); }
