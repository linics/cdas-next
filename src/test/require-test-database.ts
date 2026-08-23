import { requireIsolatedTestDatabaseUrl } from "./database-url-safety";

requireIsolatedTestDatabaseUrl({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  runtimeDatabaseUrl: process.env.DATABASE_URL,
  directDatabaseUrl: process.env.DIRECT_URL,
});
