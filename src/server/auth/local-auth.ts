import {
  argon2,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { AppUser, PrismaClient, UserRole } from "../../generated/prisma/client";
import {
  normalizeSchoolCode,
  normalizeStaffNo,
} from "../../domain/school/identity";

const PASSWORD_MEMORY_KIB = 19 * 1024;
const PASSWORD_PASSES = 2;
const PASSWORD_PARALLELISM = 2;
const PASSWORD_TAG_LENGTH = 32;
const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

export const LOCAL_SESSION_COOKIE = "cdas_session";

type PasswordEnvelope = Readonly<{
  version: "v1";
  salt: string;
  digest: string;
}>;

type ActorWithSchool = AppUser & {
  school: { id: string; status: "ACTIVE" | "DISABLED" } | null;
};

export type LocalAuthenticationResult =
  | Readonly<{ status: "SUCCESS"; actor: ActorWithSchool; token: string; mustChangePassword: boolean }>
  | Readonly<{ status: "INVALID_CREDENTIALS" | "ACCOUNT_LOCKED" | "ACCOUNT_DISABLED" | "SCHOOL_DISABLED" }>;

function encodeEnvelope(envelope: PasswordEnvelope): string {
  return `argon2id$${envelope.version}$${envelope.salt}$${envelope.digest}`;
}

function decodeEnvelope(value: string): PasswordEnvelope | null {
  const [algorithm, version, salt, digest, ...rest] = value.split("$");
  if (
    algorithm !== "argon2id" ||
    version !== "v1" ||
    !salt ||
    !digest ||
    rest.length > 0
  ) {
    return null;
  }
  return { version, salt, digest };
}

function deriveArgon2id(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: Buffer.from(password, "utf8"),
        nonce: salt,
        memory: PASSWORD_MEMORY_KIB,
        passes: PASSWORD_PASSES,
        parallelism: PASSWORD_PARALLELISM,
        tagLength: PASSWORD_TAG_LENGTH,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.from(derivedKey));
      },
    );
  });
}

/** Hashes a password with Node 24's built-in Argon2id implementation. */
export async function hashLocalPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await deriveArgon2id(password, salt);
  return encodeEnvelope({
    version: "v1",
    salt: salt.toString("base64url"),
    digest: digest.toString("base64url"),
  });
}

export async function verifyLocalPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const envelope = decodeEnvelope(storedHash);
  if (!envelope) {
    return false;
  }

  const salt = Buffer.from(envelope.salt, "base64url");
  const expected = Buffer.from(envelope.digest, "base64url");
  if (salt.length < 16 || expected.length !== PASSWORD_TAG_LENGTH) {
    return false;
  }

  const actual = await deriveArgon2id(password, salt);
  return timingSafeEqual(actual, expected);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function localAdminIdentifier(username: string): string {
  return `admin:${normalizeIdentifierSegment(username)}`;
}

export function localTeacherIdentifier(schoolCode: string, staffNo: string): string {
  return `teacher:${normalizeSchoolCode(schoolCode).toLowerCase()}:${normalizeStaffNo(staffNo).toLowerCase()}`;
}

export function localStudentIdentifier(schoolCode: string, studentNo: string): string {
  return `student:${normalizeSchoolCode(schoolCode).toLowerCase()}:${normalizeStudentNo(studentNo)}`;
}

export function normalizeStudentNo(value: string): string {
  return value.normalize("NFKC").trim();
}

export function isValidStudentNo(value: string): boolean {
  return /^[0-9]{6,32}$/u.test(normalizeStudentNo(value));
}

export function initialStudentPassword(studentNo: string): string {
  const normalized = normalizeStudentNo(studentNo);
  if (!isValidStudentNo(normalized)) {
    throw new Error("INVALID_STUDENT_NO");
  }
  return normalized.slice(-6);
}

function normalizeIdentifierSegment(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/u.test(normalized)) {
    throw new Error("INVALID_IDENTIFIER");
  }
  return normalized;
}

function actorState(actor: ActorWithSchool): Exclude<LocalAuthenticationResult["status"], "SUCCESS"> | null {
  if (actor.accountStatus !== "ACTIVE") {
    return "ACCOUNT_DISABLED";
  }
  if (actor.role !== "ADMIN" && (!actor.school || actor.school.status !== "ACTIVE")) {
    return "SCHOOL_DISABLED";
  }
  return null;
}

export async function authenticateLocalCredential(
  database: PrismaClient,
  input: Readonly<{ identifier: string; password: string; role: UserRole; now?: Date }>,
): Promise<LocalAuthenticationResult> {
  const now = input.now ?? new Date();
  const credential = await database.localCredential.findUnique({
    where: { identifier: input.identifier },
    include: {
      user: { include: { school: { select: { id: true, status: true } } } },
    },
  });

  if (!credential || credential.user.role !== input.role) {
    return { status: "INVALID_CREDENTIALS" };
  }

  const state = actorState(credential.user);
  if (state) {
    return { status: state };
  }
  if (credential.lockedUntil && credential.lockedUntil > now) {
    return { status: "ACCOUNT_LOCKED" };
  }

  const passwordMatches = await verifyLocalPassword(input.password, credential.passwordHash);
  if (!passwordMatches) {
    const failedLoginCount = credential.failedLoginCount + 1;
    await database.localCredential.update({
      where: { id: credential.id },
      data: {
        failedLoginCount,
        lockedUntil:
          failedLoginCount >= MAX_FAILED_LOGINS
            ? new Date(now.getTime() + LOCK_DURATION_MS)
            : null,
      },
    });
    return { status: failedLoginCount >= MAX_FAILED_LOGINS ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS" };
  }

  const token = createSessionToken();
  await database.$transaction([
    database.localCredential.update({
      where: { id: credential.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    }),
    database.authSession.create({
      data: {
        userId: credential.userId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(now.getTime() + SESSION_DURATION_MS),
      },
    }),
  ]);

  return {
    status: "SUCCESS",
    actor: credential.user,
    token,
    mustChangePassword: credential.mustChangePassword,
  };
}

export async function findLocalSessionActor(
  database: PrismaClient,
  token: string | undefined,
  now = new Date(),
): Promise<ActorWithSchool | null> {
  if (!token || token.length < 32) {
    return null;
  }
  const session = await database.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { include: { school: { select: { id: true, status: true } } } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= now) {
    return null;
  }
  return session.user;
}

export async function revokeLocalSession(
  database: PrismaClient,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  await database.authSession.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllLocalSessions(database: PrismaClient, userId: string): Promise<void> {
  await database.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function replaceLocalPassword(
  database: PrismaClient,
  input: Readonly<{ userId: string; password: string; mustChangePassword: boolean }>,
): Promise<void> {
  const passwordHash = await hashLocalPassword(input.password);
  await database.$transaction([
    database.localCredential.update({
      where: { userId: input.userId },
      data: {
        passwordHash,
        mustChangePassword: input.mustChangePassword,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    database.authSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
