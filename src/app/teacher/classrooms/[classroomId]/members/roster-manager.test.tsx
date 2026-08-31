import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("../../../../_components/localized-date-time", () => ({
  LocalizedDateTime: () => <time>2026-08-31</time>,
}));
vi.mock("../../../../_components/ui", () => ({
  ConfirmDialog: () => null,
  InlineAlert: ({ children }: { children: ReactNode }) => <div role="status">{children}</div>,
}));
vi.mock("./actions", () => ({
  decideRosterChangeAction: vi.fn(),
  decideStudentImportAction: vi.fn(),
  prepareEndMembershipAction: vi.fn(),
  prepareRosterImportAction: vi.fn(),
  prepareStudentImportAction: vi.fn(),
  previewRosterImportAction: vi.fn(),
  previewStudentImportAction: vi.fn(),
}));

import { RosterManager } from "./roster-manager";

describe("roster manager", () => {
  it("offers a button-like Excel picker that describes its automatic preview", () => {
    const markup = renderToStaticMarkup(
      <RosterManager
        roster={{
          actor: { displayName: "王老师" },
          classroom: {
            id: "123e4567-e89b-12d3-a456-426614174000",
            name: "七年级一班",
            version: 1,
          },
          memberships: [],
        }}
      />,
    );

    expect(markup).toContain('for="student-roster-file"');
    expect(markup).toContain("选择 Excel 文件");
    expect(markup).toContain("选择后将自动解析，并在左侧成员区预览");
  });
});
