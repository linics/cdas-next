import { describe, expect, it } from "vitest";

import {
  evaluateAgentVerification,
  verificationSql,
} from "./verify";

const happy = {
  classroom: true,
  draft: true,
  revision: true,
  release: true,
  snapshot: true,
  intent: true,
  runs: true,
  audits: true,
  idempotency: true,
  studentHistory: true,
};

describe("agent acceptance verifier", () => {
  it("requires every marker-scoped relationship", () => {
    expect(
      evaluateAgentVerification(happy).every(
        (candidate) => candidate.status === "PASS",
      ),
    ).toBe(true);
  });

  it.each(Object.keys(happy))("fails a tampered %s relationship", (key) => {
    expect(
      evaluateAgentVerification({ ...happy, [key]: false }).some(
        (candidate) => candidate.status === "FAIL",
      ),
    ).toBe(true);
  });

  it("keeps the SQL contract scoped to exact immutable provenance", () => {
    expect(verificationSql).toContain("count(*) = 3 FROM session_runs");
    expect(verificationSql).toContain("audit.source = 'UI'");
    expect(verificationSql).toContain("assistant_publish_");
    expect(verificationSql).toContain("snapshot.content = jsonb_build_object");
    expect(verificationSql).toContain("target.summary = $9");
    expect(verificationSql).toContain("count(*) = 1 FROM marker_drafts");
    expect(verificationSql).toContain("FROM teacher_feedback_revisions");
    expect(verificationSql).not.toContain("DELETE");
    expect(verificationSql).not.toContain("UPDATE");
    expect(verificationSql).not.toContain("INSERT");
  });
});
