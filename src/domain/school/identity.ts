import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { legacySchoolCode } from "./legacy-school";

const schoolCodePattern = new RegExp(
  `^(?:SCH[A-HJ-NP-Z2-9]{5}|${legacySchoolCode})$`,
  "u",
);
const staffNoPattern = /^[A-Z0-9][A-Z0-9-]{0,31}$/u;
const schoolCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

export const schoolNameSchema = z.string().trim().min(1).max(120);

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

export function pendingTeacherAuthSubject(provisioningId: string): string {
  return `pending:${provisioningId}`;
}

export function teacherIdentifier(schoolCode: string, staffNo: string): string {
  return `teacher:${normalizeSchoolCode(schoolCode).toLowerCase()}:${normalizeStaffNo(staffNo).toLowerCase()}`;
}
