import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";

const schoolCodePattern = /^(?:SCH[A-HJ-NP-Z2-9]{5}|LEGACY01)$/u;
const staffNoPattern = /^[A-Z0-9][A-Z0-9-]{0,31}$/u;
/* PostgreSQL accepts UUID values whose version/variant bits are not RFC 4122
   values. The immutable legacy-school migration deliberately uses such a
   stable UUID, so database identifiers need this lexical (not RFC-only) rule. */
const databaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const schoolCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const temporaryPasswordAlphabet =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function normalizeSchoolCode(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/gu, "");
}

export function normalizeStaffNo(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, "");
}

export const schoolCodeSchema = z
  .string()
  .transform(normalizeSchoolCode)
  .pipe(z.string().regex(schoolCodePattern));

export const staffNoSchema = z
  .string()
  .transform(normalizeStaffNo)
  .pipe(z.string().regex(staffNoPattern));

export const databaseUuidSchema = z.string().regex(databaseUuidPattern);

export function hashTeacherInvite(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}

export function generateTeacherInvite(): string {
  return randomBytes(24).toString("base64url");
}

export function generateSchoolCode(): string {
  let suffix = "";
  for (let index = 0; index < 5; index += 1) {
    suffix += schoolCodeAlphabet[randomInt(schoolCodeAlphabet.length)];
  }
  return `SCH${suffix}`;
}

export function deriveTeacherUsername(
  schoolCode: string,
  staffNo: string,
): string {
  const stableIdentity = `${normalizeSchoolCode(schoolCode)}:${normalizeStaffNo(staffNo)}`;
  const digest = createHash("sha256")
    .update(`cdas-next:teacher:${stableIdentity}`)
    .digest("hex");
  return `t_${digest.slice(0, 40)}`;
}

export function generateTemporaryPassword(): string {
  let password = "";
  for (let index = 0; index < 10; index += 1) {
    password += temporaryPasswordAlphabet[
      randomInt(temporaryPasswordAlphabet.length)
    ];
  }
  return password;
}
