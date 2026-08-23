import "dotenv/config";
import { defineConfig } from "prisma/config";

const localDatabaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:5432/cdas_next";

const directDatabaseUrl = process.env.DIRECT_URL?.trim();
const runtimeDatabaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Hosted environments use a direct connection for migrations and a pooled
    // DATABASE_URL at runtime. Local development can use the documented default.
    url: directDatabaseUrl || runtimeDatabaseUrl || localDatabaseUrl,
  },
});
