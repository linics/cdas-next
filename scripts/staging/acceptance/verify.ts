import { Client } from "pg";

import { stagingLocalIdentifier } from "../../../src/server/bootstrap/bootstrap-local-staging";
import { acceptanceNamespace, stableAcceptanceErrorCode } from "./contracts";
import { writeAcceptanceArtifact } from "./output";
import { assertPostBrowserPrerequisites } from "./prerequisites";

type Check = Readonly<{ code: string; status: "PASS" | "FAIL" }>;
type GroupResult = Readonly<{
  group_count: string;
  member_count: string;
  exact_roles: string;
  save_audits: string;
}>;
type LoopResult = Readonly<{
  draft_count: string;
  release_count: string;
  submission_count: string;
  group_submission_count: string;
  revision_count: string;
  feedback_count: string;
  closed_count: string;
  manual_count: string;
}>;
type HistoryResult = Readonly<{
  snapshot_count: string;
  executed_intents: string;
  publish_close_audits: string;
  feedback_audits: string;
  evaluation_audits: string;
  stale_close_audits: string;
}>;

function required(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }

async function main(): Promise<void> {
  const marker = required("STAGING_RUN_MARKER");
  await assertPostBrowserPrerequisites(process.env);
  const namespace = acceptanceNamespace(marker);
  const groupName = `Synthetic group ${marker}`;
  const client = new Client({ connectionString: required("DIRECT_URL") });
  const checks: Check[] = [];
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const primarySchoolCode = required("STAGING_TEST_PRIMARY_SCHOOL_CODE");
    const identityIdentifiers = [
      stagingLocalIdentifier({
        schoolCode: primarySchoolCode,
        role: "TEACHER",
        staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
      }),
      stagingLocalIdentifier({
        schoolCode: primarySchoolCode,
        role: "STUDENT",
        studentNo: required("STAGING_TEST_STUDENT_NO"),
      }),
      stagingLocalIdentifier({
        schoolCode: primarySchoolCode,
        role: "STUDENT",
        studentNo: required("STAGING_TEST_OTHER_STUDENT_NO"),
      }),
    ];
    const localIdentities = await client.query<{
      identifier: string;
      user_id: string;
    }>(
      "SELECT identifier, user_id::text FROM local_credentials WHERE identifier = ANY($1::text[])",
      [identityIdentifiers],
    );
    const subjectByIdentifier = new Map(localIdentities.rows.map((identity) => [
      identity.identifier,
      `local:${identity.user_id}`,
    ]));
    const [teacherSubject, studentSubject, otherStudentSubject] =
      identityIdentifiers.map((identifier) => subjectByIdentifier.get(identifier) ?? "");
    if (!teacherSubject || !studentSubject || !otherStudentSubject) {
      throw new Error("STAGING_ACCEPTANCE_LOCAL_IDENTITY_NOT_FOUND");
    }
    const classroom = await client.query<{ count: string }>(
      [
      "SELECT count(*)::text AS count FROM classrooms c JOIN app_users manager ON manag",
      "er.id = c.manager_id JOIN classroom_memberships m ON m.classroom_id = c.id JOIN ",
      "app_users student ON student.id = m.student_id WHERE c.id = $1::uuid AND c.name ",
      "= $2 AND manager.auth_subject = $3 AND m.ended_at IS NULL AND student.auth_subje",
      "ct IN ($4, $5) HAVING count(*) = 2 AND count(DISTINCT student.auth_subject) = 2",
    ].join(""),
      [namespace.classroomId, namespace.classroomName, teacherSubject, studentSubject, otherStudentSubject],
    );
    const allMemberships = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM classroom_memberships WHERE classroom_id = $1::uuid", [namespace.classroomId]);
    checks.push({ code: "NAMESPACE_CLASSROOM_AND_MEMBERSHIPS_EXACT", status: classroom.rows[0]?.count === "2" && allMemberships.rows[0]?.count === "3" ? "PASS" : "FAIL" });
    const membershipHistory = await client.query<{ interval_count: string; ended_count: string; current_count: string; executed_intents: string; succeeded_audits: string }>(
      [
      "SELECT count(DISTINCT m.id)::text AS interval_count, count(DISTINCT m.id) FILTER",
      " (WHERE m.ended_at IS NOT NULL)::text AS ended_count, count(DISTINCT m.id) FILTE",
      "R (WHERE m.ended_at IS NULL)::text AS current_count, count(DISTINCT ai.id) FILTE",
      "R (WHERE ai.status = 'EXECUTED' AND ai.action_name = 'apply_classroom_membership",
      "_change')::text AS executed_intents, count(DISTINCT audit.id) FILTER (WHERE audi",
      "t.outcome = 'SUCCEEDED' AND audit.action_name = 'apply_classroom_membership_chan",
      "ge')::text AS succeeded_audits FROM classrooms c JOIN classroom_memberships m ON",
      " m.classroom_id = c.id JOIN app_users student ON student.id = m.student_id LEFT ",
      "JOIN action_intents ai ON ai.target_id = c.id LEFT JOIN action_audits audit ON a",
      "udit.action_intent_id = ai.id WHERE c.id = $1::uuid AND student.auth_subject = $",
      "2",
    ].join(""),
      [namespace.classroomId, otherStudentSubject],
    );
    const membershipHistoryRow = membershipHistory.rows[0];
    checks.push({
      code: "MEMBERSHIP_HISTORY_INTENTS_AND_AUDITS_EXACT",
      status: membershipHistoryRow?.interval_count === "2" &&
        membershipHistoryRow.ended_count === "1" &&
        membershipHistoryRow.current_count === "1" &&
        membershipHistoryRow.executed_intents === "2" &&
        membershipHistoryRow.succeeded_audits === "2" ? "PASS" : "FAIL",
    });
    const group = await client.query<GroupResult>(
      [
      "WITH target AS (SELECT r.id AS release_id FROM activity_drafts d JOIN activity_r",
      "eleases r ON r.source_draft_id = d.id WHERE d.title = $2 AND d.owner_id = (SELEC",
      "T id FROM app_users WHERE auth_subject = $3) AND r.classroom_id = $1::uuid) SELE",
      "CT count(DISTINCT g.id)::text AS group_count, count(DISTINCT gm.student_id)::tex",
      "t AS member_count, count(DISTINCT gm.student_id) FILTER (WHERE (student.auth_sub",
      "ject = $5 AND gm.role_label = '记录') OR (student.auth_subject = $6 AND gm.role_la",
      "bel = '汇报'))::text AS exact_roles, count(DISTINCT audit.id) FILTER (WHERE audit.",
      "action_name = 'save_release_group' AND audit.outcome = 'SUCCEEDED')::text AS sav",
      "e_audits FROM target t JOIN release_groups g ON g.release_id = t.release_id AND ",
      "g.name = $4 LEFT JOIN release_group_members gm ON gm.group_id = g.id LEFT JOIN a",
      "pp_users student ON student.id = gm.student_id LEFT JOIN action_audits audit ON ",
      "audit.target_type = 'ReleaseGroup' AND audit.target_id = g.id",
    ].join(""),
      [namespace.classroomId, namespace.activityTitle, teacherSubject, groupName, studentSubject, otherStudentSubject],
    );
    const groupRow = group.rows[0];
    checks.push({
      code: "RELEASE_GROUP_MEMBERS_ROLES_AND_AUDIT_EXACT",
      status: groupRow?.group_count === "1" &&
        groupRow.member_count === "2" &&
        groupRow.exact_roles === "2" &&
        groupRow.save_audits === "1" ? "PASS" : "FAIL",
    });
    const loop = await client.query<LoopResult>(
      [
      "SELECT count(DISTINCT d.id)::text AS draft_count, count(DISTINCT r.id)::text AS ",
      "release_count, count(DISTINCT s.id)::text AS submission_count, count(DISTINCT s.",
      "id) FILTER (WHERE s.group_id IS NOT NULL AND s.student_id IS NULL)::text AS grou",
      "p_submission_count, count(DISTINCT sr.id)::text AS revision_count, count(DISTINC",
      "T fr.id)::text AS feedback_count, count(DISTINCT r.id) FILTER (WHERE r.status = ",
      "'CLOSED')::text AS closed_count, count(DISTINCT dr.id) FILTER (WHERE dr.source =",
      " 'MANUAL' AND dr.agent_run_id IS NULL)::text AS manual_count FROM activity_draft",
      "s d LEFT JOIN activity_draft_revisions dr ON dr.draft_id = d.id LEFT JOIN activi",
      "ty_releases r ON r.source_draft_id = d.id AND r.classroom_id = $1::uuid LEFT JOI",
      "N submissions s ON s.release_id = r.id LEFT JOIN submission_revisions sr ON sr.s",
      "ubmission_id = s.id LEFT JOIN teacher_feedback f ON f.submission_revision_id = s",
      "r.id LEFT JOIN teacher_feedback_revisions fr ON fr.teacher_feedback_id = f.id WH",
      "ERE d.title = $2 AND d.owner_id = (SELECT id FROM app_users WHERE auth_subject =",
      " $3)",
    ].join(""),
      [namespace.classroomId, namespace.activityTitle, teacherSubject],
    );
    const row = loop.rows[0];
    checks.push({
      code: "MANUAL_PHASED_GROUP_RELEASE_FEEDBACK_CLOSED",
      status: row && row.draft_count === "1" &&
        row.release_count === "1" &&
        row.submission_count === "3" &&
        row.group_submission_count === "3" &&
        row.revision_count === "3" &&
        row.feedback_count === "1" &&
        row.closed_count === "1" &&
        row.manual_count === "1" ? "PASS" : "FAIL",
    });
    const sequential = await client.query<{ execution_version: number; submission_mode: string; phase_indexes: number[]; checkpoint_revision_count: string }>(
      [
      "SELECT r.execution_version, snap.content->>'submissionMode' AS submission_mode, ",
      "array_agg(DISTINCT s.phase_index ORDER BY s.phase_index) AS phase_indexes, count",
      "(DISTINCT sr.id) FILTER (WHERE cardinality(sr.completed_evidence_indexes) = 1)::",
      "text AS checkpoint_revision_count FROM activity_drafts d JOIN activity_releases ",
      "r ON r.source_draft_id = d.id AND r.classroom_id = $1::uuid JOIN activity_releas",
      "e_snapshots snap ON snap.release_id = r.id JOIN submissions s ON s.release_id = ",
      "r.id JOIN release_group_members gm ON gm.group_id = s.group_id JOIN app_users st",
      "udent ON student.id = gm.student_id JOIN submission_revisions sr ON sr.submissio",
      "n_id = s.id WHERE d.title = $2 AND d.owner_id = (SELECT id FROM app_users WHERE ",
      "auth_subject = $3) AND student.auth_subject = $4 GROUP BY r.execution_version, s",
      "nap.content->>'submissionMode'",
    ].join(""),
      [namespace.classroomId, namespace.activityTitle, teacherSubject, studentSubject],
    );
    const sequentialRow = sequential.rows[0];
    checks.push({
      code: "VERSIONED_PHASE_SUBMISSIONS_AND_CHECKPOINTS_EXACT",
      status: sequential.rows.length === 1 &&
        sequentialRow?.execution_version === 1 &&
        sequentialRow.submission_mode === "phased" &&
        JSON.stringify(sequentialRow.phase_indexes) === "[1,2,3]" &&
        sequentialRow.checkpoint_revision_count === "3" ? "PASS" : "FAIL",
    });
    const attachment = await client.query<{ attachment_count: string; ready_count: string; formal_link_count: string }>(
      [
      "WITH target AS (SELECT r.id AS release_id FROM activity_drafts d JOIN activity_r",
      "eleases r ON r.source_draft_id = d.id WHERE d.title = $2 AND d.owner_id = (SELEC",
      "T id FROM app_users WHERE auth_subject = $3) AND r.classroom_id = $1::uuid) SELE",
      "CT count(DISTINCT attachment.id)::text AS attachment_count, count(DISTINCT attac",
      "hment.id) FILTER (WHERE attachment.status = 'READY' AND attachment.original_file",
      "name = $5)::text AS ready_count, count(DISTINCT (revision_attachment.submission_",
      "revision_id, revision_attachment.attachment_id)) FILTER (WHERE revision.id IS NO",
      "T NULL)::text AS formal_link_count FROM target JOIN submissions AS submission ON",
      " submission.release_id = target.release_id LEFT JOIN submission_attachments AS a",
      "ttachment ON attachment.submission_id = submission.id LEFT JOIN app_users AS upl",
      "oader ON uploader.id = attachment.student_id LEFT JOIN submission_revision_attac",
      "hments AS revision_attachment ON revision_attachment.attachment_id = attachment.",
      "id LEFT JOIN submission_revisions AS revision ON revision.id = revision_attachme",
      "nt.submission_revision_id AND revision.submission_id = submission.id WHERE uploa",
      "der.auth_subject = $4",
    ].join(""),
      [namespace.classroomId, namespace.activityTitle, teacherSubject, studentSubject, `synthetic-${marker}.png`],
    );
    const attachmentRow = attachment.rows[0];
    checks.push({
      code: "PRIVATE_ATTACHMENT_READY_AND_FORMALIZED",
      status: attachmentRow?.attachment_count === "1" &&
        attachmentRow.ready_count === "1" &&
        attachmentRow.formal_link_count === "1" ? "PASS" : "FAIL",
    });
    const structuredFeedback = await client.query<{ count: string }>(
      [
      "WITH target AS (SELECT r.id AS release_id FROM activity_drafts d JOIN activity_r",
      "eleases r ON r.source_draft_id = d.id WHERE d.title = $2 AND d.owner_id = (SELEC",
      "T id FROM app_users WHERE auth_subject = $3) AND r.classroom_id = $1::uuid) SELE",
      "CT count(*)::text AS count FROM target t JOIN submissions s ON s.release_id = t.",
      "release_id JOIN submission_revisions sr ON sr.submission_id = s.id JOIN teacher_",
      "feedback f ON f.submission_revision_id = sr.id JOIN teacher_feedback_revisions f",
      "r ON fr.teacher_feedback_id = f.id JOIN action_intents ai ON ai.id = fr.action_i",
      "ntent_id WHERE sr.text_evidence = $4 AND fr.body = $5 AND fr.next_step = 'REVISE",
      "' AND fr.support_level = 'FOUNDATION' AND fr.source = 'MANUAL' AND fr.agent_run_",
      "id IS NULL AND ai.status = 'EXECUTED' AND ai.action_name = 'save_teacher_feedbac",
      "k' AND ai.payload->>'schemaVersion' = '2' AND ai.payload->>'submissionId' = s.id",
      "::text AND ai.payload->>'submissionRevisionId' = sr.id::text AND (ai.payload->>'",
      "expectedSubmissionRevisionNumber')::integer = sr.revision_number AND (ai.payload",
      "->>'expectedFeedbackVersion')::integer = fr.version - 1 AND ai.payload->>'body' ",
      "= fr.body AND ai.payload->>'nextStep' = fr.next_step::text AND ai.payload->>'sup",
      "portLevel' = fr.support_level::text",
    ].join(""),
      [namespace.classroomId, namespace.activityTitle, teacherSubject, namespace.evidenceText, namespace.feedbackText],
    );
    checks.push({ code: "STRUCTURED_FEEDBACK_AND_INTENT_EXACT", status: structuredFeedback.rows[0]?.count === "1" ? "PASS" : "FAIL" });
    const structuredEvaluation = await client.query<{ count: string }>(
      [
      `WITH target AS (SELECT r.id AS release_id FROM activity_drafts d JOIN activity_r`,
      `eleases r ON r.source_draft_id = d.id WHERE d.title = $2 AND d.owner_id = (SELEC`,
      `T id FROM app_users WHERE auth_subject = $3) AND r.classroom_id = $1::uuid) SELE`,
      `CT count(*)::text AS count FROM target t JOIN submissions s ON s.release_id = t.`,
      `release_id JOIN submission_revisions sr ON sr.submission_id = s.id JOIN teacher_`,
      `evaluations e ON e.submission_revision_id = sr.id JOIN teacher_evaluation_revisi`,
      `ons er ON er.teacher_evaluation_id = e.id JOIN action_intents ai ON ai.id = er.a`,
      `ction_intent_id WHERE sr.text_evidence = $4 AND er.summary = $5 AND er.source = `,
      `'MANUAL' AND er.agent_run_id IS NULL AND jsonb_array_length(er.outcomes) = 4 AND`,
      ` er.outcomes @> '[{"dimensionIndex":1,"dimensionName":"问题意识","status":"LEVEL","l`,
      `evel":"excellent","citations":[{"kind":"text"}]}]'::jsonb AND er.outcomes @> '[{`,
      `"dimensionIndex":2,"dimensionName":"证据质量","status":"INSUFFICIENT_EVIDENCE","cita`,
      `tions":[]}]'::jsonb AND er.outcomes @> '[{"dimensionIndex":4,"dimensionName":"方案`,
      `表达","status":"LEVEL","level":"pass","citations":[{"kind":"checkpoint","evidenceI`,
      `ndex":1}]}]'::jsonb AND EXISTS (SELECT 1 FROM jsonb_array_elements(er.outcomes) `,
      `outcome JOIN jsonb_array_elements(outcome->'citations') citation ON true JOIN su`,
      `bmission_revision_attachments sra ON sra.submission_revision_id = sr.id JOIN sub`,
      `mission_attachments sa ON sa.id = sra.attachment_id WHERE outcome->>'dimensionIn`,
      `dex' = '3' AND outcome->>'dimensionName' = '跨学科连接' AND outcome->>'status' = 'LEV`,
      `EL' AND outcome->>'level' = 'good' AND citation->>'kind' = 'attachment' AND cita`,
      `tion->>'attachmentId' = sa.id::text AND sa.status = 'READY') AND ai.status = 'EX`,
      `ECUTED' AND ai.action_name = 'save_teacher_evaluation' AND ai.payload->>'schemaV`,
      `ersion' = '1' AND ai.payload->>'submissionId' = s.id::text AND ai.payload->>'sub`,
      `missionRevisionId' = sr.id::text AND (ai.payload->>'expectedSubmissionRevisionNu`,
      `mber')::integer = sr.revision_number AND (ai.payload->>'expectedEvaluationVersio`,
      `n')::integer = er.version - 1 AND ai.payload->>'summary' = er.summary`,
    ].join(""),
      [namespace.classroomId, namespace.activityTitle, teacherSubject, namespace.evidenceText, namespace.evaluationText],
    );
    checks.push({ code: "EVIDENCE_BOUND_EVALUATION_AND_INTENT_EXACT", status: structuredEvaluation.rows[0]?.count === "1" ? "PASS" : "FAIL" });
    const history = await client.query<HistoryResult>(
      [
      "WITH target AS (SELECT d.id AS draft_id, r.id AS release_id, r.action_intent_id,",
      " r.close_action_intent_id FROM activity_drafts d JOIN activity_releases r ON r.s",
      "ource_draft_id = d.id WHERE d.title = $2 AND d.owner_id = (SELECT id FROM app_us",
      "ers WHERE auth_subject = $3) AND r.classroom_id = $1::uuid), feedback_intents AS",
      " (SELECT fr.action_intent_id FROM target t JOIN submissions s ON s.release_id = ",
      "t.release_id JOIN submission_revisions sr ON sr.submission_id = s.id JOIN teache",
      "r_feedback f ON f.submission_revision_id = sr.id JOIN teacher_feedback_revisions",
      " fr ON fr.teacher_feedback_id = f.id WHERE sr.text_evidence = $4 AND fr.body = $",
      "5 AND fr.source = 'MANUAL' AND fr.agent_run_id IS NULL), evaluation_intents AS (",
      "SELECT er.action_intent_id FROM target t JOIN submissions s ON s.release_id = t.",
      "release_id JOIN submission_revisions sr ON sr.submission_id = s.id JOIN teacher_",
      "evaluations e ON e.submission_revision_id = sr.id JOIN teacher_evaluation_revisi",
      "ons er ON er.teacher_evaluation_id = e.id WHERE sr.text_evidence = $4 AND er.sum",
      "mary = $6 AND er.source = 'MANUAL' AND er.agent_run_id IS NULL) SELECT count(DIS",
      "TINCT snap.release_id) FILTER (WHERE snap.source_draft_version = 1 AND snap.cont",
      "ent->>'title' = $2)::text AS snapshot_count, count(DISTINCT ai.id) FILTER (WHERE",
      " ai.status = 'EXECUTED' AND ai.agent_run_id IS NULL AND ai.action_name IN ('publ",
      "ish_activity_release', 'close_activity_release', 'save_teacher_feedback', 'save_",
      "teacher_evaluation'))::text AS executed_intents, count(DISTINCT audit.id) FILTER",
      " (WHERE audit.outcome = 'SUCCEEDED' AND audit.action_name IN ('publish_activity_",
      "release', 'close_activity_release'))::text AS publish_close_audits, count(DISTIN",
      "CT feedback_audit.id) FILTER (WHERE feedback_audit.outcome = 'SUCCEEDED' AND fee",
      "dback_audit.action_name = 'save_teacher_feedback')::text AS feedback_audits, cou",
      "nt(DISTINCT evaluation_audit.id) FILTER (WHERE evaluation_audit.outcome = 'SUCCE",
      "EDED' AND evaluation_audit.action_name = 'save_teacher_evaluation')::text AS eva",
      "luation_audits, count(DISTINCT stale_audit.id) FILTER (WHERE stale_audit.outcome",
      " = 'CONFLICTED' AND stale_audit.error_code = 'RELEASE_NOT_ACTIVE' AND stale_audi",
      "t.action_name = 'save_submission_working_copy')::text AS stale_close_audits FROM",
      " target t LEFT JOIN activity_release_snapshots snap ON snap.release_id = t.relea",
      "se_id LEFT JOIN action_intents ai ON ai.id IN (t.action_intent_id, t.close_actio",
      "n_intent_id) OR ai.id IN (SELECT action_intent_id FROM feedback_intents) OR ai.i",
      "d IN (SELECT action_intent_id FROM evaluation_intents) LEFT JOIN action_audits a",
      "udit ON audit.action_intent_id IN (t.action_intent_id, t.close_action_intent_id)",
      " LEFT JOIN action_audits feedback_audit ON feedback_audit.action_intent_id IN (S",
      "ELECT action_intent_id FROM feedback_intents) LEFT JOIN action_audits evaluation",
      "_audit ON evaluation_audit.action_intent_id IN (SELECT action_intent_id FROM eva",
      "luation_intents) LEFT JOIN action_audits stale_audit ON stale_audit.target_id = ",
      "t.release_id",
    ].join(""),
      [namespace.classroomId, namespace.activityTitle, teacherSubject, namespace.evidenceText, namespace.feedbackText, namespace.evaluationText],
    );
    const historyRow = history.rows[0];
    checks.push({
      code: "SNAPSHOT_INTENTS_AUDITS_AND_STALE_CLOSE_REJECTION",
      status: historyRow && historyRow.snapshot_count === "1" &&
        historyRow.executed_intents === "4" &&
        historyRow.publish_close_audits === "2" &&
        historyRow.feedback_audits === "1" &&
        historyRow.evaluation_audits === "1" &&
        historyRow.stale_close_audits === "1" ? "PASS" : "FAIL",
    });
    const otherHistory = await client.query<{ submission_count: string; revision_count: string; feedback_count: string; evaluation_count: string; personal_submission_count: string }>(
      [
      "WITH target AS (SELECT r.id AS release_id FROM activity_drafts d JOIN activity_r",
      "eleases r ON r.source_draft_id = d.id WHERE d.title = $2 AND d.owner_id = (SELEC",
      "T id FROM app_users WHERE auth_subject = $3) AND r.classroom_id = $1::uuid), oth",
      "er AS (SELECT id FROM app_users WHERE auth_subject = $4) SELECT count(DISTINCT s",
      ".id)::text AS submission_count, count(DISTINCT sr.id)::text AS revision_count, c",
      "ount(DISTINCT fr.id)::text AS feedback_count, count(DISTINCT er.id)::text AS eva",
      "luation_count, (SELECT count(*)::text FROM target personal_target JOIN submissio",
      "ns personal ON personal.release_id = personal_target.release_id CROSS JOIN other",
      " personal_other WHERE personal.student_id = personal_other.id) AS personal_submi",
      "ssion_count FROM target t CROSS JOIN other o JOIN release_group_members gm ON gm",
      ".student_id = o.id JOIN release_groups g ON g.id = gm.group_id AND g.release_id ",
      "= t.release_id LEFT JOIN submissions s ON s.release_id = t.release_id AND s.grou",
      "p_id = g.id LEFT JOIN submission_revisions sr ON sr.submission_id = s.id LEFT JO",
      "IN teacher_feedback f ON f.submission_revision_id = sr.id LEFT JOIN teacher_feed",
      "back_revisions fr ON fr.teacher_feedback_id = f.id LEFT JOIN teacher_evaluations",
      " e ON e.submission_revision_id = sr.id LEFT JOIN teacher_evaluation_revisions er",
      " ON er.teacher_evaluation_id = e.id",
    ].join(""),
      [namespace.classroomId, namespace.activityTitle, teacherSubject, otherStudentSubject],
    );
    const otherHistoryRow = otherHistory.rows[0];
    checks.push({
      code: "GROUPMATE_SHARED_HISTORY_EXACT",
      status: otherHistoryRow?.submission_count === "3" &&
        otherHistoryRow.revision_count === "3" &&
        otherHistoryRow.feedback_count === "1" &&
        otherHistoryRow.evaluation_count === "1" &&
        otherHistoryRow.personal_submission_count === "0" ? "PASS" : "FAIL",
    });
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { await client.end(); }
  const status = checks.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
  await writeAcceptanceArtifact(marker, "verify.json", {
    schema: "staging-synthetic-acceptance-verify.v1",
    status,
    checks,
    readOnlyTransaction: true,
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  });
  process.stdout.write(`${JSON.stringify({ schema: "staging-synthetic-acceptance-verify.v1", status })}\n`);
  if (status !== "PASS") process.exitCode = 1;
}

void main().catch(async (error: unknown) => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  try {
    await writeAcceptanceArtifact(marker, "verify.json", {
      schema: "staging-synthetic-acceptance-verify.v1",
      status: "FAIL",
      checks: [{ code: stableAcceptanceErrorCode(error), status: "FAIL" }],
      readOnlyTransaction: true,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    });
  } catch {
    /* no output outside safe namespace */
  }
  process.stdout.write(`{"schema":"staging-synthetic-acceptance-verify.v1","status":"FAIL","code":"${stableAcceptanceErrorCode(error)}"}\n`);
  process.exitCode = 1;
});
