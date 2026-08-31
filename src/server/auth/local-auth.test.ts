import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  hashLocalPassword,
  initialStudentPassword,
  isValidStudentNo,
  localAdminIdentifier,
  localStudentIdentifier,
  localTeacherIdentifier,
  verifyLocalPassword,
} from "./local-auth";

describe("local credential primitives", () => {
  it("uses an Argon2id envelope that verifies only the original password", async () => {
    const hash = await hashLocalPassword("Strong-teacher-password-2026");
    expect(hash).toMatch(/^argon2id\$v1\$/u);
    await expect(verifyLocalPassword("Strong-teacher-password-2026", hash)).resolves.toBe(true);
    await expect(verifyLocalPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("derives role-separated local identifiers and a six-digit student initial password", () => {
    expect(localAdminIdentifier("Platform.Admin")).toBe("admin:platform.admin");
    expect(localTeacherIdentifier("schab234", "T-001")).toContain("teacher:schab234:t-001");
    expect(localStudentIdentifier("SCHAB234", "20260001")).toBe("student:schab234:20260001");
    expect(initialStudentPassword("20260001")).toBe("260001");
    expect(isValidStudentNo("000001")).toBe(true);
    expect(isValidStudentNo("A00001")).toBe(false);
  });
});
