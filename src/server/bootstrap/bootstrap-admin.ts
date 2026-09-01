import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";

export const bootstrapAdminInputSchema = z
  .object({
    adminIdentifier: z.string().trim().regex(/^admin:[a-z0-9][a-z0-9._-]{0,63}$/u),
    passwordHash: z.string().trim().min(1).max(256),
    adminDisplayName: z.string().trim().min(1).max(120),
  })
  .strict();

export const bootstrapAdminResultSchema = z
  .object({
    admin: z
      .object({
        id: z.uuid(),
        status: z.enum(["CREATED", "EXISTING"]),
      })
      .strict(),
  })
  .strict();

export type BootstrapAdminInput = z.input<typeof bootstrapAdminInputSchema>;
export type BootstrapAdminResult = z.infer<typeof bootstrapAdminResultSchema>;

export class BootstrapAdminError extends Error {
  constructor(
    public readonly code:
      | "USER_ROLE_CONFLICT"
      | "USER_PROFILE_CONFLICT"
      | "ADMIN_ALREADY_EXISTS"
      | "CONCURRENT_WRITE",
  ) {
    super(code);
    this.name = "BootstrapAdminError";
  }
}

export async function bootstrapPlatformAdmin(
  database: PrismaClient,
  rawInput: BootstrapAdminInput,
  clock: () => Date = () => new Date(),
): Promise<BootstrapAdminResult> {
  const input = bootstrapAdminInputSchema.parse(rawInput);
  const now = clock();
  const identifier = input.adminIdentifier;
  const passwordHash = input.passwordHash;

  try {
    return await database.$transaction(async (transaction) => {
      const existingCredential = await transaction.localCredential.findUnique({
        where: { identifier },
        select: { user: { select: { id: true, role: true, displayName: true } } },
      });
      if (existingCredential) {
        if (existingCredential.user.role !== "ADMIN") {
          throw new BootstrapAdminError("USER_ROLE_CONFLICT");
        }
        if (existingCredential.user.displayName !== input.adminDisplayName) {
          throw new BootstrapAdminError("USER_PROFILE_CONFLICT");
        }
        return bootstrapAdminResultSchema.parse({
          admin: { id: existingCredential.user.id, status: "EXISTING" },
        });
      }

      const otherAdmin = await transaction.appUser.findFirst({
        where: { role: "ADMIN" },
        select: { id: true, displayName: true, localCredential: { select: { id: true } } },
      });
      if (otherAdmin) {
        if (otherAdmin.localCredential) {
          throw new BootstrapAdminError("ADMIN_ALREADY_EXISTS");
        }
        if (otherAdmin.displayName !== input.adminDisplayName) {
          throw new BootstrapAdminError("USER_PROFILE_CONFLICT");
        }
        await transaction.appUser.update({
          where: { id: otherAdmin.id },
          data: { authSubject: `local:${otherAdmin.id}` },
        });
        await transaction.localCredential.create({
          data: { userId: otherAdmin.id, identifier, passwordHash },
        });
        return bootstrapAdminResultSchema.parse({
          admin: { id: otherAdmin.id, status: "EXISTING" },
        });
      }

      const adminId = randomUUID();
      const created = await transaction.appUser.create({
        data: {
          id: adminId,
          authSubject: `local:${adminId}`,
          displayName: input.adminDisplayName,
          role: "ADMIN",
          accountStatus: "ACTIVE",
          legacyProfile: false,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      await transaction.localCredential.create({
        data: { userId: created.id, identifier, passwordHash },
      });
      return bootstrapAdminResultSchema.parse({
        admin: { id: created.id, status: "CREATED" },
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new BootstrapAdminError("ADMIN_ALREADY_EXISTS");
    }
    throw error;
  }
}
