import { z } from "zod";

export const passwordSchema = z
  .string()
  .refine((value) => [...value].length >= 10, "密码至少 10 个字符")
  .refine((value) => [...value].length <= 128, "密码最多 128 个字符")
  .refine((value) => /\p{L}/u.test(value), "密码需包含字母")
  .refine((value) => /\p{N}/u.test(value), "密码需包含数字");

export function assertPassword(value: string): string {
  return passwordSchema.parse(value);
}
