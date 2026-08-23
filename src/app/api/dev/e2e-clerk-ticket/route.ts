import { issueE2eClerkTicket } from "../../../../server/auth/e2e-clerk-ticket-broker";

export const runtime = "nodejs";

function noStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
  };
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  const providedSecret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const result = await issueE2eClerkTicket(
    request.headers.get("x-cdas-e2e-role"),
    providedSecret,
  );
  if (!result.ok) {
    return new Response(null, {
      status: result.status,
      headers: noStoreHeaders(),
    });
  }
  return Response.json(result, { headers: noStoreHeaders() });
}
