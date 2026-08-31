export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Deliberately credential-free readiness endpoint for the loopback trial. */
export function GET(): Response {
  const ready = Boolean(process.env.DATABASE_URL) && process.env.AI_PROVIDER_DISABLED === "1";
  return Response.json(
    ready ? { status: "ok", authentication: "local", ai: "disabled" } : { status: "unconfigured" },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
