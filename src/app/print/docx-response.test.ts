import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
}));
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { AuthenticationError } from "../../server/auth/current-actor";
import { TaskBookPrintError } from "../../server/queries/task-book-print";
import { docxResponse } from "./docx-response";

describe("task book DOCX response (D-074)", () => {
  it("returns a private Word attachment named after the task book", async () => {
    const response = await docxResponse(async () => ({
      kind: "DRAFT",
      content: waterConservationTaskBookV3,
      version: 2,
      datedAt: "2026-09-20T02:00:00Z",
      classroomName: null,
      dueAt: null,
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("wordprocessingml");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(decodeURIComponent(response.headers.get("content-disposition")!)).toContain("校园节水行动-草稿第2版.docx");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");
  });

  it("maps failures without detail", async () => {
    const fail = (error: Error) => docxResponse(async () => { throw error; });
    expect((await fail(new AuthenticationError("UNAUTHENTICATED" as never))).status).toBe(401);
    expect((await fail(new TaskBookPrintError("NOT_FOUND"))).status).toBe(404);
    expect((await fail(new TaskBookPrintError("UNSUPPORTED_SCHEMA"))).status).toBe(409);
  });
});
