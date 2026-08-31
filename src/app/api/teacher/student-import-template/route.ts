import { createStudentRosterTemplate } from "../../../../domain/classroom/student-roster-xlsx";

export const runtime = "nodejs";

export function GET(): Response {
  const template = createStudentRosterTemplate();
  const body = template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": "attachment; filename=student-roster-template.xlsx",
      "cache-control": "no-store",
    },
  });
}
