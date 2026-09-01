import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import {
  applyLegacySchoolToClassroomData,
  applyLegacySchoolToUserData,
} from "../../domain/school/legacy-school";

export function createDatabaseClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  return prisma.$extends({
    query: {
      appUser: {
        async create({ args, query }) {
          args.data = applyLegacySchoolToUserData(args.data);
          return query(args);
        },
        async createMany({ args, query }) {
          const data = args.data;
          args.data = Array.isArray(data)
            ? data.map((row) => applyLegacySchoolToUserData(row))
            : applyLegacySchoolToUserData(data);
          return query(args);
        },
      },
      classroom: {
        async create({ args, query }) {
          args.data = applyLegacySchoolToClassroomData(args.data);
          return query(args);
        },
        async createMany({ args, query }) {
          const data = args.data;
          args.data = Array.isArray(data)
            ? data.map((row) => applyLegacySchoolToClassroomData(row))
            : applyLegacySchoolToClassroomData(data);
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

const globalDatabase = globalThis as typeof globalThis & {
  cdasDatabase?: PrismaClient;
};

export function getDatabaseClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for database-backed routes");
  }

  // Reuse one client (and therefore one pg pool) per application process. In
  // development the global also survives Next.js module reloads; in production
  // it prevents every Server Action from opening another pool.
  globalDatabase.cdasDatabase ??= createDatabaseClient(connectionString);
  return globalDatabase.cdasDatabase;
}
