import { createStudentRosterTemplate } from "../../../../domain/classroom/student-roster-xlsx";
import { AuthenticationError, getCurrentActor } from "../../../../server/auth/current-actor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  let actor;
  try {
    actor = await getCurrentActor();
  } catch (error) {
    if (error instanceof AuthenticationError) return new Response(null, { status: 401 });
    throw error;
  }
  if (actor.role !== "TEACHER") return new Response(null, { status: 403 });

  const template = createStudentRosterTemplate();
  const body = template.buffer.slice(
    template.byteOffset,
    template.byteOffset + template.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": "attachment; filename=student-roster-template.xlsx",
      "cache-control": "no-store",
    },
  });
}
