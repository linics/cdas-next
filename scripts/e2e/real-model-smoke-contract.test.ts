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
    expect(realModelFlowSource).toContain("03-real-model-draft-proposal");
    expect(realModelFlowSource).toContain("04-real-model-draft-preview");
    expect(
      realModelFlowSource.indexOf("03-real-model-draft-proposal"),
    ).toBeLessThan(realModelFlowSource.indexOf("preview_link.click()"));
  });

  it("reads back a hand-written draft before the model authors one", () => {
    expect(realModelFlowSource).toContain("fill_activity_form(");
    expect(realModelFlowSource).toContain("读取草稿 · ");
    expect(realModelFlowSource).toContain("REAL_MODEL_DRAFT_READ_LINK_MISSING");
    expect(realModelFlowSource).toContain("REAL_MODEL_DRAFT_READ_NAVIGATED");
    expect(realModelFlowSource).toContain("00-real-model-draft-read");
    expect(
      realModelFlowSource.indexOf("00-real-model-draft-read"),
    ).toBeLessThan(realModelFlowSource.indexOf("03-real-model-draft-proposal"));
  });

  it("confirms a revision of that draft before writing it", () => {
    expect(realModelFlowSource).toContain('aria-label="草稿改写确认"');
    expect(realModelFlowSource).toContain("确认并改写草稿");
    expect(realModelFlowSource).toContain("任务链阶段");
    expect(realModelFlowSource).toContain("草稿已改写 · 版本 1 → 2");
    expect(realModelFlowSource).toContain("REAL_MODEL_DRAFT_REVISION_NAVIGATED");
    expect(
      realModelFlowSource.indexOf('aria-label="草稿改写确认"'),
    ).toBeLessThan(realModelFlowSource.indexOf("草稿已改写 · 版本 1 → 2"));
  });

  it("requires exactly a no-write proposal run followed by the draft execution run", () => {
    expect(verifierSource).toContain("runs.length === 5");
    expect(verifierSource).toContain("readRun.draftRevision === null");
    expect(verifierSource).toContain("readRun.intents.length === 0");
    expect(verifierSource).toContain("readRun.auditEntries.length === 0");
    expect(verifierSource).toContain("proposalRun.draftRevision === null");
    expect(verifierSource).toContain("proposalRun.intents.length === 0");
    expect(verifierSource).toContain("proposalRun.auditEntries.length === 0");
    expect(verifierSource).toContain("run.id === revision.agentRunId");
    expect(verifierSource).toContain("runCount === 5");
    expect(verifierSource).toContain("revisionProposalRun.draftRevision === null");
    expect(verifierSource).toContain("revisionRun.id === agentRevision?.agentRunId");
    expect(verifierSource).toContain("E2E_REAL_MODEL_REVISION_HISTORY_MISMATCH");
    expect(verifierSource).toContain("intentCount === 0");
    expect(verifierSource).toContain("releaseCount === 0");
  });
});
