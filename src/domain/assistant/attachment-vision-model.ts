/**
 * The vision model an attachment-reading deployment calls when
 * `AI_ATTACHMENT_VISION_MODEL` is unset.
 *
 * Lives in the domain layer, with no `server-only` guard, because two very
 * different callers must resolve the identical value: the runtime that actually
 * makes the call, and the deployment proof that claims which models this
 * deployment runs. The proof is also recomputed by a plain Node staging script,
 * which cannot import a `server-only` module at all. A second copy of this
 * string would let the proof describe a model the deployment does not call.
 */
export const defaultAttachmentVisionModel = "deepseek-v4-flash-vision-exp";
