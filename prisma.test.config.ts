import "dotenv/config";
import { defineConfig } from "prisma/config";
import { requireIsolatedTestDatabaseUrl } from "./src/test/database-url-safety";

const testDatabaseUrl = requireIsolatedTestDatabaseUrl({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  runtimeDatabaseUrl: process.env.DATABASE_URL,
  directDatabaseUrl: process.env.DIRECT_URL,
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: testDatabaseUrl,
  },
});
