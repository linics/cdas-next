import { z } from "zod";

const uuidPathSegment = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export const teacherAgentPageKindSchema = z.enum([
  "TEACHER_DASHBOARD",
  "ACTIVITY_NEW",
  "ACTIVITY_DRAFT",
  "ACTIVITY_PREVIEW",
  "RELEASE_SUBMISSIONS",
  "SUBMISSION_REVIEW",
  "TEACHER_INSIGHTS",
  "TEACHER_KNOWLEDGE",
  "CLASSROOM_MEMBERS",
  "UNKNOWN_TEACHER_PAGE",
]);

const staticPageContextSchema = z
  .object({
    kind: z.enum([
      "TEACHER_DASHBOARD",
      "ACTIVITY_NEW",
      "SUBMISSION_REVIEW",
      "TEACHER_INSIGHTS",
      "TEACHER_KNOWLEDGE",
      "UNKNOWN_TEACHER_PAGE",
    ]),
  })
  .strict();

const resourcePageContextSchema = z
  .object({
    kind: z.enum([
      "ACTIVITY_DRAFT",
      "ACTIVITY_PREVIEW",
      "RELEASE_SUBMISSIONS",
      "CLASSROOM_MEMBERS",
    ]),
    resourceId: z.uuid(),
  })
  .strict();

export const teacherAgentPageContextSchema = z.union([
  staticPageContextSchema,
  resourcePageContextSchema,
]);

export type TeacherAgentPageContext = z.infer<
  typeof teacherAgentPageContextSchema
>;

const resourceRoutes: ReadonlyArray<
  readonly [
    RegExp,
    Extract<TeacherAgentPageContext, { resourceId: string }>["kind"],
  ]
> = [
  [
    new RegExp(`^/teacher/activities/(${uuidPathSegment})/preview$`, "i"),
    "ACTIVITY_PREVIEW",
  ],
  [
    new RegExp(`^/teacher/activities/(${uuidPathSegment})$`, "i"),
    "ACTIVITY_DRAFT",
  ],
  [
    new RegExp(`^/teacher/releases/(${uuidPathSegment})/submissions$`, "i"),
    "RELEASE_SUBMISSIONS",
  ],
  [
    new RegExp(`^/teacher/classrooms/(${uuidPathSegment})/members$`, "i"),
    "CLASSROOM_MEMBERS",
  ],
];

const staticRoutes = new Map<string, TeacherAgentPageContext["kind"]>([
  ["/teacher", "TEACHER_DASHBOARD"],
  ["/teacher/activities/new", "ACTIVITY_NEW"],
  ["/teacher/insights", "TEACHER_INSIGHTS"],
  ["/teacher/knowledge", "TEACHER_KNOWLEDGE"],
]);

/**
 * The browser pathname is reduced to a fixed vocabulary before it leaves the
 * client. Query strings, arbitrary URLs and submission identifiers are never
 * included. The server treats this value only as a hint and re-authorizes any
 * dynamic resource before producing a link.
 */
export function getTeacherAgentPageContext(
  pathname: string,
): TeacherAgentPageContext {
  const staticKind = staticRoutes.get(pathname);
  if (staticKind) {
    return { kind: staticKind } as TeacherAgentPageContext;
  }

  for (const [pattern, kind] of resourceRoutes) {
    const match = pattern.exec(pathname);
    if (match?.[1]) {
      return { kind, resourceId: match[1].toLowerCase() };
    }
  }

  if (new RegExp(`^/teacher/submissions/${uuidPathSegment}$`, "i").test(pathname)) {
    return { kind: "SUBMISSION_REVIEW" };
  }

  return { kind: "UNKNOWN_TEACHER_PAGE" };
}
