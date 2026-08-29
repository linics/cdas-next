import "server-only";

import { z } from "zod";
import { defaultAttachmentVisionModel } from "../../domain/assistant/attachment-vision-model";

const modelIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(/^deepseek-[a-z0-9][a-z0-9._:-]*$/);



const enabledConfigSchema = z.object({
  apiKey: z.string().trim().min(1).max(2_000),
  model: modelIdSchema,
  attachmentVisionModel: modelIdSchema,
  approvalSecret: z.string().min(32).max(4_096),
});

export type ActivityAssistantConfig = Readonly<
  z.infer<typeof enabledConfigSchema>
>;

export class ActivityAssistantConfigError extends Error {
  constructor(
    public readonly code:
      | "AI_DISABLED"
      | "DEEPSEEK_API_NOT_CONFIGURED"
      | "AI_MODEL_NOT_CONFIGURED"
      | "AI_APPROVAL_SECRET_NOT_CONFIGURED",
  ) {
    super(code);
    this.name = "ActivityAssistantConfigError";
  }
}

type AssistantEnvironment = Readonly<
  Record<string, string | undefined>
>;

function isExplicitlyDisabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(
    value?.trim().toLowerCase() ?? "",
  );
}

/**
 * Resolve every provider/security setting before constructing a model or
 * opening an AgentRun. The returned object is server-only and must never be
 * serialized into the assistant stream.
 */
export function getActivityAssistantConfig(
  environment: AssistantEnvironment = process.env,
): ActivityAssistantConfig {
  if (isExplicitlyDisabled(environment.AI_PROVIDER_DISABLED)) {
    throw new ActivityAssistantConfigError("AI_DISABLED");
  }

  const apiKey = environment.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new ActivityAssistantConfigError(
      "DEEPSEEK_API_NOT_CONFIGURED",
    );
  }

  const model = environment.AI_MODEL?.trim();
  if (!model || !modelIdSchema.safeParse(model).success) {
    throw new ActivityAssistantConfigError("AI_MODEL_NOT_CONFIGURED");
  }

  const approvalSecret = environment.AI_TOOL_APPROVAL_SECRET;
  if (!approvalSecret || approvalSecret.length < 32) {
    throw new ActivityAssistantConfigError(
      "AI_APPROVAL_SECRET_NOT_CONFIGURED",
    );
  }

  const attachmentVisionModel =
    environment.AI_ATTACHMENT_VISION_MODEL?.trim() ||
    defaultAttachmentVisionModel;
  if (!modelIdSchema.safeParse(attachmentVisionModel).success) {
    throw new ActivityAssistantConfigError("AI_MODEL_NOT_CONFIGURED");
  }

  return enabledConfigSchema.parse({
    apiKey,
    model,
    attachmentVisionModel,
    approvalSecret,
  });
}

/**
 * Server-component gate. It performs configuration validation only; it does
 * not construct a provider, open an AgentRun, or expose configuration values.
 */
export function isActivityAssistantEnabled(
  environment: AssistantEnvironment = process.env,
): boolean {
  try {
    getActivityAssistantConfig(environment);
    return true;
  } catch (error) {
    if (
      error instanceof ActivityAssistantConfigError ||
      error instanceof z.ZodError
    ) {
      return false;
    }
    throw error;
  }
}
