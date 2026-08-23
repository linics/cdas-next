import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

export function createDatabaseClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
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
