import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { historyProtectionDefinitionManifest } from "./database-manifest";
import {
  requiredHistoryProtectionConstraints,
  requiredHistoryProtectionFunctions,
  requiredHistoryProtectionTriggers,
} from "./database";

const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe("staging database definition manifest", () => {
  it("matches the final migrated PostgreSQL 17 catalog without writes", async () => {
    await client.query("BEGIN READ ONLY");
    try {
      const result = await client.query<{ name: string; definition: string }>(
        "SELECT 'function:public.' || routine.proname || '(' || pg_get_function_identity_arguments(routine.oid) || ')' AS name, pg_get_functiondef(routine.oid) AS definition FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace WHERE namespace.nspname = 'public' AND routine.proname = ANY($1::text[]) UNION ALL SELECT 'trigger:public.' || relation.relname || '.' || trigger.tgname AS name, pg_get_triggerdef(trigger.oid, false) AS definition FROM pg_catalog.pg_trigger trigger JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal AND trigger.tgname = ANY($2::text[]) UNION ALL SELECT 'constraint:public.' || relation.relname || '.' || constraint_record.conname AS name, pg_get_constraintdef(constraint_record.oid, false) AS definition FROM pg_catalog.pg_constraint constraint_record JOIN pg_catalog.pg_class relation ON relation.oid = constraint_record.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' AND constraint_record.conname = ANY($3::text[])",
        [requiredHistoryProtectionFunctions, requiredHistoryProtectionTriggers, requiredHistoryProtectionConstraints],
      );
      const hashes = Object.fromEntries(result.rows.map((row) => [
        row.name,
        createHash("sha256").update(`${row.name}\0${row.definition}`, "utf8").digest("hex"),
      ]));
      expect(hashes).toEqual(historyProtectionDefinitionManifest);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
