import { describe, expect, it } from "vitest";
import {
  requireIsolatedE2eDatabaseUrl,
  requireIsolatedTestDatabaseUrl,
} from "./database-url-safety";

const testUrl =
  "postgresql://test-user:test-password@127.0.0.1:5433/cdas_next_test?schema=public";

describe("requireIsolatedTestDatabaseUrl", () => {
  it("returns a valid disposable PostgreSQL URL without exposing it", () => {
    expect(
      requireIsolatedTestDatabaseUrl({
        testDatabaseUrl: `  ${testUrl}  `,
        runtimeDatabaseUrl:
          "postgresql://postgres:postgres@127.0.0.1:5432/cdas_next",
      }),
    ).toBe(testUrl);
  });

  it.each([
    [undefined, "TEST_DATABASE_URL_REQUIRED"],
    ["", "TEST_DATABASE_URL_REQUIRED"],
    ["not-a-url", "TEST_DATABASE_URL_INVALID"],
    ["https://database.example/cdas_next_test", "TEST_DATABASE_URL_INVALID"],
    ["postgresql://localhost", "TEST_DATABASE_URL_INVALID"],
    ["postgresql://localhost/bad%ZZname", "TEST_DATABASE_URL_INVALID"],
    ["postgresql://localhost/postgres", "TEST_DATABASE_URL_RESERVED_DATABASE"],
    ["postgresql://localhost/template0", "TEST_DATABASE_URL_RESERVED_DATABASE"],
  ])("rejects an unsafe test target without echoing it", (value, code) => {
    expect(() =>
      requireIsolatedTestDatabaseUrl({ testDatabaseUrl: value }),
    ).toThrow(code);
  });

  it.each([
    {
      runtimeDatabaseUrl:
        "postgresql://runtime:other@127.0.0.1:5433/cdas_next_test",
    },
    {
      runtimeDatabaseUrl:
        "postgresql://runtime:other@localhost:5433/cdas_next_test?pgbouncer=true",
    },
    {
      directDatabaseUrl:
        "postgres://direct:other@127.0.0.1:5433/cdas_next_test?schema=other",
    },
  ])("rejects a runtime or direct URL targeting the same database", (urls) => {
    expect(() =>
      requireIsolatedTestDatabaseUrl({ testDatabaseUrl: testUrl, ...urls }),
    ).toThrow("TEST_DATABASE_URL_NOT_ISOLATED");
  });

  it("protects the documented local runtime database when DATABASE_URL is omitted", () => {
    expect(() =>
      requireIsolatedTestDatabaseUrl({
        testDatabaseUrl:
          "postgresql://fixture:anything@localhost:5432/cdas_next",
      }),
    ).toThrow("TEST_DATABASE_URL_NOT_ISOLATED");
  });

  it("protects the documented local runtime database when DATABASE_URL is blank", () => {
    expect(() =>
      requireIsolatedTestDatabaseUrl({
        testDatabaseUrl:
          "postgresql://fixture:anything@localhost:5432/cdas_next",
        runtimeDatabaseUrl: "   ",
      }),
    ).toThrow("TEST_DATABASE_URL_NOT_ISOLATED");
  });

  it("does not include credentials or URLs in validation errors", () => {
    const secret = "do-not-log-this-password";
    expect(() =>
      requireIsolatedTestDatabaseUrl({
        testDatabaseUrl: `postgresql://user:${secret}@localhost/postgres`,
      }),
    ).toThrowError("TEST_DATABASE_URL_RESERVED_DATABASE");
    try {
      requireIsolatedTestDatabaseUrl({
        testDatabaseUrl: `postgresql://user:${secret}@localhost/postgres`,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("requireIsolatedE2eDatabaseUrl", () => {
  const e2eUrl =
    "postgresql://e2e-user:e2e-password@127.0.0.1:5434/cdas_next_e2e?schema=public";

  it("returns a dedicated browser-test target", () => {
    expect(
      requireIsolatedE2eDatabaseUrl({
        e2eDatabaseUrl: `  ${e2eUrl}  `,
        runtimeDatabaseUrl:
          "postgresql://postgres:postgres@127.0.0.1:5432/cdas_next",
        testDatabaseUrl: testUrl,
      }),
    ).toBe(e2eUrl);
  });

  it.each([
    [undefined, "E2E_DATABASE_URL_REQUIRED"],
    ["", "E2E_DATABASE_URL_REQUIRED"],
    ["not-a-url", "E2E_DATABASE_URL_INVALID"],
    ["postgresql://localhost/postgres", "E2E_DATABASE_URL_RESERVED_DATABASE"],
    [
      "postgresql://e2e:anything@db.example.com/cdas_next_e2e",
      "E2E_DATABASE_URL_LOCAL_REQUIRED",
    ],
    [
      "postgresql://e2e:anything@localhost/cdas_next_staging",
      "E2E_DATABASE_URL_DEDICATED_DATABASE_REQUIRED",
    ],
  ])("rejects an unsafe browser-test target", (value, code) => {
    expect(() =>
      requireIsolatedE2eDatabaseUrl({ e2eDatabaseUrl: value }),
    ).toThrow(code);
  });

  it.each([
    {
      runtimeDatabaseUrl:
        "postgresql://runtime:other@localhost:5434/cdas_next_e2e",
    },
    {
      directDatabaseUrl:
        "postgresql://direct:other@127.0.0.1:5434/cdas_next_e2e?schema=other",
    },
    {
      testDatabaseUrl:
        "postgres://test:other@127.0.0.1:5434/cdas_next_e2e",
    },
  ])("rejects overlap with every non-E2E database target", (urls) => {
    expect(() =>
      requireIsolatedE2eDatabaseUrl({ e2eDatabaseUrl: e2eUrl, ...urls }),
    ).toThrow("E2E_DATABASE_URL_NOT_ISOLATED");
  });

  it("does not include E2E credentials in errors", () => {
    const secret = "do-not-log-this-e2e-password";
    try {
      requireIsolatedE2eDatabaseUrl({
        e2eDatabaseUrl: `postgresql://user:${secret}@localhost/postgres`,
      });
    } catch (error) {
      expect(String(error)).toBe("Error: E2E_DATABASE_URL_RESERVED_DATABASE");
      expect(String(error)).not.toContain(secret);
    }
  });
});
