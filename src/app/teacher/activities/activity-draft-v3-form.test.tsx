import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { waterConservationTaskBookV3 } from "../../../fixtures/water-conservation-v3";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("./v3-actions", () => ({
  saveActivityDraftV3Action: vi.fn(),
}));

import { ActivityDraftV3Form } from "./activity-draft-v3-form";

const draftId = "10000000-0000-4000-8000-000000000001";

function renderForm(status: "EDITING" | "READY_FOR_PREVIEW") {
  return renderToStaticMarkup(
    <ActivityDraftV3Form
      initialState={{
        status: "idle",
        message: "",
        values: waterConservationTaskBookV3,
        draftId,
        expectedVersion: 3,
        persistedStatus: status,
        nextIdempotencyKey: "save_activity_draft_test_001",
      }}
    />,
  );
}

describe("activity draft v3 form", () => {
  it("renders the publish-preview entry as soon as a draft is ready", () => {
    const markup = renderForm("READY_FOR_PREVIEW");

    expect(markup).toContain("查看发布预览");
    expect(markup).toContain(`href=\"/teacher/activities/${draftId}/preview\"`);
  });

  it("does not offer publication preview while the draft is still editing", () => {
    expect(renderForm("EDITING")).not.toContain("查看发布预览");
  });
});
