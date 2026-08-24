import { describe, expect, it } from "vitest";

import {
  evaluateAgentVerification,
  fullLoopVerificationSql,
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
  primarySubmission: true,
  teacherFeedback: true,
  closeIntentAndAudits: true,
  staleWrite: true,
  otherStudentHistory: true,
  otherTeacherActions: true,
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
    expect(verificationSql).toContain("count(*) = 4 FROM session_runs");
    expect(verificationSql).toContain("run4 AS");
    expect(verificationSql).toContain(
      "row_number() OVER (ORDER BY run.started_at, run.id) AS position",
    );
    // Exact positions bind the no-write proposal runs (1 and 3) and their
    // subsequent business executions (2 and 4). An extra run, a swapped
    // execution, or a business side effect on either proposal makes the SQL
    // `runs` relationship false.
    expect(verificationSql).toContain("WHERE run.position = 1");
    expect(verificationSql).toContain("WHERE run.position = 2");
    expect(verificationSql).toContain("WHERE run.position = 3");
    expect(verificationSql).toContain("WHERE run.position = 4");
    expect(verificationSql).toContain(
      "JOIN agent_revision AS revision ON revision.agent_run_id = run.id\n  WHERE run.position = 2",
    );
    expect(verificationSql).toContain(
      "JOIN intent ON intent.agent_run_id = run.id\n  WHERE run.position = 4",
    );
    expect(verificationSql).toContain("audit.source = 'UI'");
    expect(verificationSql).toContain("assistant_publish_");
    expect(verificationSql).toContain("snapshot.content = revision.task_book");
    expect(verificationSql).toContain('"cdas_activity_task_book_v2_is_valid"(revision.task_book)');
    expect(verificationSql).toContain("target.summary = $9");
    expect(verificationSql).toContain("cardinality(target.learning_objectives) > 0");
    expect(verificationSql).toContain("revision.summary <> target.summary");
    expect(verificationSql).toContain(
      "revision.task_book -> 'learningObjectives' = to_jsonb(revision.learning_objectives)",
    );
    expect(
      verificationSql.match(
        /revision\.learning_objectives = target\.learning_objectives/gu,
      ),
    ).toHaveLength(1);
    expect(verificationSql).toContain("manual_revision");
    expect(verificationSql).toContain("revision.version = 2");
    expect(verificationSql).toContain("audit.source = 'AGENT'");
    expect(verificationSql).toContain("count(*) = 5 FROM target_audits");
    expect(verificationSql).toContain("count(*) = 4 FROM target_idempotency");
    expect(verificationSql).toContain("count(*) = 1 FROM marker_drafts");
    expect(verificationSql).toContain("target.release_status = 'CLOSED'");
    expect(verificationSql).toContain("membership.student_id = (SELECT id FROM other_student)");
    expect(fullLoopVerificationSql).toContain("submit_submission_revision");
    expect(fullLoopVerificationSql).toContain("save_teacher_feedback");
    expect(fullLoopVerificationSql).toContain("close_activity_release");
    expect(fullLoopVerificationSql).toContain("RELEASE_NOT_ACTIVE");
    expect(fullLoopVerificationSql).toContain("other_teacher_target_audits");
    expect(verificationSql).not.toContain("DELETE");
    expect(verificationSql).not.toContain("UPDATE");
    expect(verificationSql).not.toContain("INSERT");
    expect(fullLoopVerificationSql).not.toContain("DELETE");
    expect(fullLoopVerificationSql).not.toContain("UPDATE");
    expect(fullLoopVerificationSql).not.toContain("INSERT");
  });
});
