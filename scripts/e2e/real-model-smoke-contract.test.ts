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

  it("drives both drafters and the process diagnostics through the real model", () => {
    expect(realModelFlowSource).toContain("让助手起草这一版反馈");
    expect(realModelFlowSource).toContain("让助手起草这一版评价");
    expect(realModelFlowSource).toContain("确认并保存最终反馈");
    expect(realModelFlowSource).toContain("确认并保存量规评价");
    expect(realModelFlowSource).toContain("AI 建议 · 教师已确认");
    expect(realModelFlowSource).toContain("drafted-feedback.txt");
    expect(realModelFlowSource).toContain("过程诊断 · ");
    expect(realModelFlowSource).toContain("已评价 1 份");
    expect(realModelFlowSource).toContain("REAL_MODEL_INSIGHTS_COUNT_MISMATCH");
  });

  it("reads the roster as ordinals and proves no student name reaches it", () => {
    expect(realModelFlowSource).toContain("提交名册 · ");
    expect(realModelFlowSource).toContain("对象 1");
    expect(realModelFlowSource).toContain("REAL_MODEL_ROSTER_ORDINAL_MISSING");
    expect(realModelFlowSource).toContain(
      "REAL_MODEL_ROSTER_LEAKED_STUDENT_NAME",
    );
    // The leak guard must fail closed rather than pass with nothing to match.
    expect(realModelFlowSource).toContain(
      "REAL_MODEL_ROSTER_STUDENT_NAME_UNKNOWN",
    );
    expect(realModelFlowSource).toContain("REAL_MODEL_ROSTER_REVIEW_LINK_MISSING");
    expect(verifierSource).toContain("rosterRun.auditEntries.length === 0");
  });

  it("requires both suggestion runs to reach a confirmed AI_ASSISTED revision", () => {
    expect(verifierSource).toContain("suggest_teacher_feedback");
    expect(verifierSource).toContain("suggest_teacher_evaluation");
    expect(verifierSource).toContain('feedbackRevision?.source === "AI_ASSISTED"');
    expect(verifierSource).toContain('evaluationRevision?.source === "AI_ASSISTED"');
    expect(verifierSource).toContain(
      "E2E_REAL_MODEL_SUGGESTION_BODY_PERSISTED_IN_AUDIT",
    );
    expect(verifierSource).toContain("E2E_REAL_MODEL_AGENT_PUBLISHED_RELEASE");
    expect(verifierSource).toContain("insightsRun.auditEntries.length === 0");
    expect(verifierSource).toContain(
      "E2E_REAL_MODEL_CONFIRMED_FEEDBACK_BODY_MISMATCH",
    );
  });

  it("requires exactly a no-write proposal run followed by the draft execution run", () => {
    expect(verifierSource).toContain("runs.length === 9");
    expect(verifierSource).toContain("readRun.draftRevision === null");
    expect(verifierSource).toContain("readRun.intents.length === 0");
    expect(verifierSource).toContain("readRun.auditEntries.length === 0");
    expect(verifierSource).toContain("proposalRun.draftRevision === null");
    expect(verifierSource).toContain("proposalRun.intents.length === 0");
    expect(verifierSource).toContain("proposalRun.auditEntries.length === 0");
    expect(verifierSource).toContain("run.id === revision.agentRunId");
    expect(verifierSource).toContain("runCount === 9");
    expect(verifierSource).toContain("revisionProposalRun.draftRevision === null");
    expect(verifierSource).toContain("revisionRun.id === agentRevision?.agentRunId");
    expect(verifierSource).toContain("E2E_REAL_MODEL_REVISION_HISTORY_MISMATCH");
    expect(verifierSource).toContain("intentCount > 0");
    expect(verifierSource).toContain("releaseCount === 1");
  });
});
