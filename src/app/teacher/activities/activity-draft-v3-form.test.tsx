import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  teacherEvaluationLevelLabels,
  teacherEvaluationLevels,
} from "../../../domain/evaluation/teacher-evaluation-policy";
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
vi.mock("./working-copy-actions", () => ({
  autosaveTaskBookAction: vi.fn(),
  discardTaskBookWorkingCopyAction: vi.fn(),
}));

import { ActivityDraftV3Form } from "./activity-draft-v3-form";
import { emptyActivityDraftV3Values } from "./activity-draft-v3-state";

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

  it("names the rubric levels the way the student's evaluation does", () => {
    // D-090: the form said 达标 while the evaluation said 合格 for one level.
    const markup = renderForm("EDITING");

    for (const level of teacherEvaluationLevels) {
      expect(markup).toContain(`<label>${teacherEvaluationLevelLabels[level]}<textarea`);
    }
    expect(markup).not.toContain("合格");
  });

  it("lists what a blank task book still needs instead of blocking on browser validation (D-093)", () => {
    const markup = renderToStaticMarkup(
      <ActivityDraftV3Form
        initialState={{
          status: "idle",
          message: "",
          values: emptyActivityDraftV3Values,
          draftId: null,
          expectedVersion: null,
          persistedStatus: null,
          nextIdempotencyKey: "save_activity_draft_test_002",
        }}
      />,
    );

    expect(markup).toContain("还差");
    expect(markup).toContain("任务标题");
    expect(markup).toContain('href="#task-book-basics"');
    expect(markup).toContain('id="task-book-rubric"');
    expect(markup).toContain("开始填写后会自动保存");
    expect(markup).not.toContain('required=""');
    expect(markup).not.toContain("哈希");
  });

  it("says a complete task book can be saved as a version", () => {
    expect(renderForm("EDITING")).toContain("内容已经齐全，可以保存为版本。");
  });

  it("asks before continuing when the unsaved copy was made on an older version", () => {
    const markup = renderToStaticMarkup(
      <ActivityDraftV3Form
        pendingCopy={{
          id: "20000000-0000-4000-8000-000000000002",
          version: 4,
          baseVersion: 2,
          savedAt: "2026-10-06T02:00:00.000Z",
        }}
        initialState={{
          status: "idle",
          message: "",
          values: waterConservationTaskBookV3,
          draftId,
          expectedVersion: 3,
          persistedStatus: "EDITING",
          nextIdempotencyKey: "save_activity_draft_test_003",
        }}
      />,
    );

    expect(markup).toContain("基于第 2 版");
    expect(markup).toContain(`href="/teacher/activities/${draftId}?restore=working-copy"`);
    expect(markup).toContain("放弃，用第 3 版");
  });
});
