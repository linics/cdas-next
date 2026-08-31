import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";

const clerkSubjectSchema = z
  .string()
  .trim()
  .min(6)
  .max(200)
  .regex(/^user_[A-Za-z0-9]+$/u, "Expected a Clerk user ID beginning with user_");

export const bootstrapAdminInputSchema = z
  .object({
    adminAuthSubject: clerkSubjectSchema,
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

  try {
    return await database.$transaction(async (transaction) => {
      const existingSubject = await transaction.appUser.findUnique({
        where: { authSubject: input.adminAuthSubject },
        select: { id: true, role: true, displayName: true },
      });
      if (existingSubject) {
        if (existingSubject.role !== "ADMIN") {
          throw new BootstrapAdminError("USER_ROLE_CONFLICT");
        }
        if (existingSubject.displayName !== input.adminDisplayName) {
          throw new BootstrapAdminError("USER_PROFILE_CONFLICT");
        }
        return bootstrapAdminResultSchema.parse({
          admin: { id: existingSubject.id, status: "EXISTING" },
        });
      }

      const otherAdmin = await transaction.appUser.findFirst({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      if (otherAdmin) {
        throw new BootstrapAdminError("ADMIN_ALREADY_EXISTS");
      }

      const created = await transaction.appUser.create({
        data: {
          authSubject: input.adminAuthSubject,
          displayName: input.adminDisplayName,
          role: "ADMIN",
          accountStatus: "ACTIVE",
          legacyProfile: false,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
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
