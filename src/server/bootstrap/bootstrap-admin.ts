import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { localAdminIdentifier } from "../auth/local-auth";

const usernameSchema = z.string().trim().min(3).max(64);
export const bootstrapAdminInputSchema = z.object({ username: usernameSchema, passwordHash: z.string().min(32).max(256) }).strict();
const bootstrapAdminResultSchema = z.object({ id: z.uuid(), role: z.literal("ADMIN"), status: z.enum(["CREATED", "EXISTING"]) }).strict();
export type BootstrapAdminInput = z.input<typeof bootstrapAdminInputSchema>;
export type BootstrapAdminResult = z.infer<typeof bootstrapAdminResultSchema>;

export class BootstrapAdminError extends Error {
  constructor(public readonly code: "IDENTIFIER_ROLE_CONFLICT" | "ADMIN_ALREADY_BOUND") { super(code); this.name = "BootstrapAdminError"; }
}

function requestHash(username: string): string {
  const value = canonicalize({ action: "bootstrap_platform_admin", username: username.trim().toLowerCase() });
  if (value === undefined) throw new TypeError("Bootstrap request cannot be canonicalized");
  return createHash("sha256").update(value).digest("hex");
}

/** Creates exactly one shared platform-admin local account. */
export async function bootstrapAdmin(database: PrismaClient, rawInput: BootstrapAdminInput): Promise<BootstrapAdminResult> {
  const input = bootstrapAdminInputSchema.parse(rawInput);
  const identifier = localAdminIdentifier(input.username);
  const result = await database.$transaction(async (transaction) => {
    const existingCredential = await transaction.localCredential.findUnique({ where: { identifier }, include: { user: { select: { id: true, role: true } } } });
    if (existingCredential) {
      if (existingCredential.user.role !== "ADMIN") throw new BootstrapAdminError("IDENTIFIER_ROLE_CONFLICT");
      return { id: existingCredential.user.id, role: "ADMIN" as const, status: "EXISTING" as const };
    }
    const existingAdmin = await transaction.appUser.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    if (existingAdmin) throw new BootstrapAdminError("ADMIN_ALREADY_BOUND");
    const id = randomUUID();
    await transaction.appUser.create({ data: { id, authSubject: `local:${id}`, role: "ADMIN", displayName: "平台管理员", schoolId: null, staffNo: null, studentNo: null, primaryDisciplineCode: null, secondaryDisciplineCodes: [], accountStatus: "ACTIVE", legacyProfile: false } });
    await Promise.all([
      transaction.localCredential.create({ data: { userId: id, identifier, passwordHash: input.passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } }),
      transaction.actionAudit.create({ data: { actorId: id, source: "SYSTEM", actionName: "bootstrap_platform_admin", targetType: "AppUser", targetId: id, requestHash: requestHash(input.username), outcome: "SUCCEEDED", traceId: "admin-bootstrap" } }),
    ]);
    return { id, role: "ADMIN" as const, status: "CREATED" as const };
  });
  return bootstrapAdminResultSchema.parse(result);
}
