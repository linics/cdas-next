import { z } from "zod";

const nonBlankText = z.string().trim().min(1);

export const activityContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: nonBlankText.max(120),
    summary: nonBlankText.max(600),
    learningObjectives: z.array(nonBlankText.max(240)).min(1).max(8),
    taskInstructions: nonBlankText.max(5_000),
    evidenceRequirements: z.array(nonBlankText.max(300)).min(1).max(8),
    feedbackCriteria: z.array(nonBlankText.max(240)).min(1).max(8),
  })
  .strict();

export type ActivityContent = z.infer<typeof activityContentSchema>;
