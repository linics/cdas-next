import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const browserSource = readFileSync(
  "scripts/e2e/run-closed-loop.py",
  "utf8",
);
const verifierSource = readFileSync(
  "scripts/e2e/verify-real-model-smoke.ts",
  "utf8",
);
const realModelFlowSource = browserSource.slice(
  browserSource.indexOf("def run_real_model_browser_flow"),
);

describe("real-model smoke D-033 contract", () => {
  it("captures and confirms the structured proposal before preview navigation", () => {
    expect(realModelFlowSource).toContain("D-033 結構化任務理解與設計建議");
    expect(realModelFlowSource).toContain('aria-label="任务理解确认"');
    expect(realModelFlowSource).toContain("确认理解并创建草稿");
    expect(realModelFlowSource).toContain("教师已提供要求");
    expect(realModelFlowSource).toContain("跨学科必要性");
    expect(realModelFlowSource).toContain("目标—任务—证据—评价一致性链");
    expect(realModelFlowSource).toContain("01-real-model-draft-proposal");
    expect(realModelFlowSource).toContain("02-real-model-draft-preview");
    expect(
      realModelFlowSource.indexOf("01-real-model-draft-proposal"),
    ).toBeLessThan(realModelFlowSource.indexOf("page.wait_for_url("));
  });

  it("requires exactly a no-write proposal run followed by the draft execution run", () => {
    expect(verifierSource).toContain("runs.length === 2");
    expect(verifierSource).toContain("proposalRun.draftRevision === null");
    expect(verifierSource).toContain("proposalRun.intents.length === 0");
    expect(verifierSource).toContain("proposalRun.auditEntries.length === 0");
    expect(verifierSource).toContain("run.id === revision.agentRunId");
    expect(verifierSource).toContain("runCount === 2");
    expect(verifierSource).toContain("intentCount === 0");
    expect(verifierSource).toContain("releaseCount === 0");
  });
});
