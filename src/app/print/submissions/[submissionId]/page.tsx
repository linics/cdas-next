import Link from "next/link";
import { notFound } from "next/navigation";
import { ZodError } from "zod";
import { Button } from "@/components/ui/button";
import {
  evidenceTypeLabel,
  isStructuredContent,
} from "../../../../domain/activity/activity-content";
import {
  teacherEvaluationLevelLabels,
  teacherEvaluationOutcomeStatusLabels,
} from "../../../../domain/evaluation/teacher-evaluation-policy";
import {
  teacherFeedbackNextStepLabels,
  teacherFeedbackSupportLevelLabels,
} from "../../../../domain/feedback/teacher-feedback-policy";
import { hasMeaningfulTextEvidence } from "../../../../domain/submission/text-evidence";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { AuthenticationError } from "../../../../server/auth/current-actor";
import { createUiCommandContext } from "../../../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../../../server/db/client";
import {
  FeedbackWorkspaceQueryError,
  getTeacherFeedbackWorkspace,
  type TeacherFeedbackWorkspace,
} from "../../../../server/queries/feedback-workspace";
import { TeacherAccessGate } from "../../../teacher/_components/teacher-shell";
import { PrintButton } from "../../print-button";

const sheet =
  "print-sheet leading-7 [&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6";

/**
 * A learning-outcome report for one student or group (D-072): the current
 * formal revision and only what the teacher has confirmed about it. Earlier
 * revisions, earlier feedback versions, working copies, AI drafts and file
 * contents stay out; attachments appear by name only.
 */
export default async function PrintSubmissionReportPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  let workspace: TeacherFeedbackWorkspace;
  try {
    const database = getDatabaseClient();
    const context = await createUiCommandContext(database);
    workspace = await getTeacherFeedbackWorkspace(database, context, { submissionId });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return (
        <TeacherAccessGate
          code={error.code}
          returnPath={`/print/submissions/${submissionId}`}
        />
      );
    }
    if (error instanceof FeedbackWorkspaceQueryError || error instanceof ZodError) {
      notFound();
    }
    throw error;
  }

  const { submission, student, group } = workspace;
  const revision = submission.revisions.at(-1);
  if (!revision) notFound();
  const content = submission.release.snapshot.content;
  const phase =
    isStructuredContent(content) && submission.phaseIndex > 0
      ? (content.phases[submission.phaseIndex - 1] ?? null)
      : null;
  const feedback = revision.feedback?.revisions.at(-1) ?? null;
  const evaluation = revision.evaluation?.revisions.at(-1) ?? null;

  return (
    <main className="mx-auto w-full max-w-[210mm] bg-white px-8 py-10 text-black shadow-sm print:max-w-none print:p-0 print:shadow-none">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3" data-print="hide">
        <Button asChild variant="outline">
          <Link href={`/teacher/submissions/${submission.id}`}>返回评阅</Link>
        </Button>
        <PrintButton />
      </div>

      <header className="mb-6 border-b border-black/30 pb-4">
        <p className="text-sm text-black/70">
          学习成果报告 · {submission.release.classroom.name}
          {submission.phaseName
            ? ` · 第 ${submission.phaseIndex} 阶段「${submission.phaseName}」`
            : " · 整项提交"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{content.title}</h1>
        <p className="mt-2">
          {group
            ? `${group.name}（${group.members.map((member) => member.student.displayName).join("、")}）`
            : student.displayName}
        </p>
        <p className="mt-1 text-sm text-black/70">
          第 {revision.revisionNumber} 版正式提交 · <LocalizedDateTime dateTime={revision.submittedAt} />
          {revision.isLate ? " · 迟交" : ""}
          {submission.revisions.length > 1 ? ` · 此前共 ${submission.revisions.length - 1} 版` : ""}
        </p>
      </header>

      <article className={sheet}>
        {phase ? (
          <section>
            <h2>本阶段要求</h2>
            <p>{phase.action}</p>
            <p>评价要点：{phase.evaluationFocus}</p>
          </section>
        ) : null}

        <section>
          <h2>提交内容</h2>
          {hasMeaningfulTextEvidence(revision.textEvidence) ? (
            <p className="whitespace-pre-wrap">{revision.textEvidence}</p>
          ) : (
            <p>这一版没有文字内容。</p>
          )}
          {phase && revision.completedEvidenceIndexes.length > 0 ? (
            <ul>
              {revision.completedEvidenceIndexes.map((evidenceIndex) => {
                const evidence = phase.evidence[evidenceIndex - 1];
                return evidence ? (
                  <li key={evidenceIndex}>
                    已确认：{evidence.description}（{evidenceTypeLabel(evidence.type)}）
                  </li>
                ) : null;
              })}
            </ul>
          ) : null}
          {revision.attachments.length > 0 ? (
            <p>附件：{revision.attachments.map((attachment) => attachment.filename).join("、")}</p>
          ) : null}
        </section>

        <section>
          <h2>教师反馈</h2>
          {feedback ? (
            <>
              <p className="whitespace-pre-wrap">{feedback.body}</p>
              {feedback.nextStep && feedback.supportLevel ? (
                <p>
                  下一步：{teacherFeedbackNextStepLabels[feedback.nextStep]} ·{" "}
                  {teacherFeedbackSupportLevelLabels[feedback.supportLevel]}
                </p>
              ) : null}
              <p className="text-sm text-black/70">
                确认于 <LocalizedDateTime dateTime={feedback.confirmedAt} />
              </p>
            </>
          ) : (
            <p>这一版尚无确认的反馈。</p>
          )}
        </section>

        {isStructuredContent(content) ? (
          <section>
            <h2>量规评价</h2>
            {evaluation ? (
              <>
                <ul>
                  {evaluation.outcomes.map((outcome) => (
                    <li key={outcome.dimensionIndex}>
                      <strong>{outcome.dimensionName}</strong>：
                      {outcome.status === "LEVEL" && "level" in outcome
                        ? teacherEvaluationLevelLabels[outcome.level]
                        : teacherEvaluationOutcomeStatusLabels.INSUFFICIENT_EVIDENCE}
                    </li>
                  ))}
                </ul>
                <p className="whitespace-pre-wrap">{evaluation.summary}</p>
                <p className="text-sm text-black/70">
                  确认于 <LocalizedDateTime dateTime={evaluation.confirmedAt} />
                </p>
              </>
            ) : (
              <p>这一版尚无确认的量规评价。</p>
            )}
          </section>
        ) : null}
      </article>
    </main>
  );
}
