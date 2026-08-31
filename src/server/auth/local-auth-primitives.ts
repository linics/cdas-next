import { argon2, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { passwordSchema } from "./password-policy";
import { normalizeSchoolCode, normalizeStaffNo } from "../../domain/school/identity";

export const HASH_PREFIX = "$cdas$argon2id$v=1$m=19456,t=2,p=2$";

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => argon2("argon2id", {
    message: Buffer.from(password), nonce: salt, memory: 19 * 1024,
    passes: 2, parallelism: 2, tagLength: 32,
  }, (error, key) => error ? reject(error) : resolve(Buffer.from(key))));
}

export async function hashPassword(password: string): Promise<string> {
  passwordSchema.parse(password);
  const salt = randomBytes(16);
  const digest = await derive(password, salt);
  return `${HASH_PREFIX}${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^\$cdas\$argon2id\$v=1\$m=19456,t=2,p=2\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/u.exec(encoded);
  if (!match) return false;
  const salt = Buffer.from(match[1], "base64url");
  const expected = Buffer.from(match[2], "base64url");
  if (salt.length !== 16 || expected.length !== 32) return false;
  return timingSafeEqual(await derive(password, salt), expected);
}

export function adminIdentifier(username: string): string {
  const value = username.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)) throw new Error("INVALID_IDENTIFIER");
  return `admin:${value}`;
}
export function teacherIdentifier(schoolCode: string, staffNo: string): string {
  return `teacher:${normalizeSchoolCode(schoolCode).toLowerCase()}:${normalizeStaffNo(staffNo).toLowerCase()}`;
}
export function studentIdentifier(schoolCode: string, studentNo: string): string {
  const number = studentNo.normalize("NFKC").trim();
  if (!/^\d{6,32}$/u.test(number)) throw new Error("INVALID_IDENTIFIER");
  return `student:${normalizeSchoolCode(schoolCode).toLowerCase()}:${number}`;
}
export function createSessionToken(): string { return randomBytes(32).toString("base64url"); }
export function hashSessionToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
