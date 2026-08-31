import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: { kind: "admin-page-database" },
  context: {
    actorId: "10000000-0000-4000-8000-000000000001",
    source: "UI" as const,
    traceId: "admin-page-trace",
    clock: () => new Date("2026-08-30T00:00:00.000Z"),
  },
  createUiCommandContext: vi.fn(),
  connection: vi.fn(),
  getDatabaseClient: vi.fn(),
  getAdminDashboard: vi.fn(),
  listAdminSchools: vi.fn(),
  listAdminTeachers: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("../../server/db/client", () => ({ getDatabaseClient: mocks.getDatabaseClient }));
vi.mock("../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createUiCommandContext,
}));
vi.mock("../../server/auth/current-actor", () => ({
  AuthenticationError: class AuthenticationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AuthenticationError";
    }
  },
}));
vi.mock("../../server/school/admin-authorization", () => ({
  AdminAuthorizationError: class AdminAuthorizationError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "AdminAuthorizationError";
    }
  },
}));
vi.mock("../../server/queries/admin-dashboard", () => ({
  getAdminDashboard: mocks.getAdminDashboard,
  listAdminSchools: mocks.listAdminSchools,
  listAdminTeachers: mocks.listAdminTeachers,
}));
vi.mock("./_components/admin-shell", () => ({
  AdminAccessGate: ({ code }: { code: string }) => <div data-admin-access-gate={code}>管理员安全门</div>,
  AdminPage: ({ children }: { children: ReactNode }) => <>{children}</>,
  adminHomeCrumb: { href: "/admin", label: "管理员工作台" },
}));
vi.mock("./schools/school-manager", () => ({
  SchoolManager: ({ schools }: { schools: readonly { name: string }[] }) => <div>学校数量：{schools.length}</div>,
}));
vi.mock("./teachers/teacher-manager", () => ({
  TeacherManager: ({ teachers }: { teachers: readonly { displayName: string }[] }) => <div>教师数量：{teachers.length}</div>,
}));

import { AuthenticationError } from "../../server/auth/current-actor";
import AdminDashboardPage from "./page";
import AdminSchoolsPage from "./schools/page";
import AdminTeachersPage from "./teachers/page";

describe("administrator pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.mockResolvedValue(undefined);
    mocks.createUiCommandContext.mockResolvedValue(mocks.context);
    mocks.getDatabaseClient.mockReturnValue(mocks.database);
    mocks.getAdminDashboard.mockResolvedValue({
      schoolCount: 2,
      teacherCount: 4,
      studentCount: 36,
      classroomCount: 5,
    });
    mocks.listAdminSchools.mockResolvedValue([{ id: "school-a", name: "学校 A" }]);
    mocks.listAdminTeachers.mockResolvedValue([{ id: "teacher-a", displayName: "王老师" }]);
  });

  it("renders only school, teacher, and aggregate management on the administrator dashboard", async () => {
    const markup = renderToStaticMarkup(await AdminDashboardPage());

    expect(markup).toContain("学校与教师管理");
    expect(markup).not.toContain("不读取任务书、学生作品、反馈或评价");
    expect(markup).toContain("学校管理");
    expect(markup).toContain("教师管理");
    expect(markup).not.toContain("AI Agent");
    expect(mocks.connection).toHaveBeenCalledTimes(1);
    expect(mocks.getAdminDashboard).toHaveBeenCalledWith(mocks.database, mocks.context, {});
  });

  it("stops at the admin access gate before creating a database client", async () => {
    mocks.createUiCommandContext.mockRejectedValue(new AuthenticationError("UNAUTHENTICATED"));

    const markup = renderToStaticMarkup(await AdminDashboardPage());

    expect(markup).toContain("管理员安全门");
    expect(mocks.getDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.getAdminDashboard).not.toHaveBeenCalled();
  });

  it("keeps school and teacher management as separate, data-minimal pages", async () => {
    const schoolMarkup = renderToStaticMarkup(await AdminSchoolsPage());
    const teacherMarkup = renderToStaticMarkup(await AdminTeachersPage());

    expect(schoolMarkup).not.toContain("创建学校后会获得固定学校代码和一次性教师邀请码");
    expect(schoolMarkup).toContain("学校数量：1");
    expect(teacherMarkup).not.toContain("教师通过学校邀请码自行注册");
    expect(teacherMarkup).toContain("教师数量：1");
    expect(mocks.listAdminSchools).toHaveBeenCalledWith(mocks.database, mocks.context, {});
    expect(mocks.listAdminTeachers).toHaveBeenCalledWith(mocks.database, mocks.context, {});
    expect(mocks.connection).toHaveBeenCalledTimes(2);
  });
});
