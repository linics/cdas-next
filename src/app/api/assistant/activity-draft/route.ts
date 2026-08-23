import { handleActivityAssistantRequest } from "../../../../server/assistant/activity-assistant-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleActivityAssistantRequest(request);
}
