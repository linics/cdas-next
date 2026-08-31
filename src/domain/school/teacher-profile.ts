import { z } from "zod";
import { disciplineCodeSchema } from "../activity/activity-content";

const displayNameSchema = z.string().trim().min(1).max(120);

/** Fields a teacher may edit about themself. School and staff number are
 * deliberately absent: both form the durable school identity boundary. */
export const teacherProfileFieldsSchema = z
  .object({
    displayName: displayNameSchema,
    primaryDisciplineCode: disciplineCodeSchema,
    secondaryDisciplineCodes: z.array(disciplineCodeSchema).max(14),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.secondaryDisciplineCodes).size !== value.secondaryDisciplineCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["secondaryDisciplineCodes"],
        message: "Secondary disciplines must not repeat",
      });
    }
    if (value.secondaryDisciplineCodes.includes(value.primaryDisciplineCode)) {
      context.addIssue({
        code: "custom",
        path: ["secondaryDisciplineCodes"],
        message: "Primary discipline cannot also be secondary",
      });
    }
  });

export type TeacherProfileFields = z.infer<typeof teacherProfileFieldsSchema>;
