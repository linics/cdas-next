import "server-only";

import { z } from "zod";
import {
  activityContentSchema,
  isStructuredContent,
} from "../../domain/activity/activity-content";
import {
  ANSWER_THEMES_MAX_ANSWERS,
  ANSWER_THEMES_MIN_ANSWERS,
  storedAnswerThemesSchema,
  type AnswerForThemes,
  type AnswerThemeKind,
} from "../../domain/insights/answer-themes";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";

const basisInputSchema = z.strictObject({
  releaseId: z.uuid(),
  phaseIndex: z.int().min(0).max(99),
});

export type ReleaseAnswerBasis = Readonly<{
  releaseTitle: string;
  phaseLabel: string;
  /** What the students were asked to do and hand in for this phase. */
  requirement: Readonly<{ action: string; evidence: readonly string[] }>;
  answers: readonly AnswerForThemes[];
}>;

export type AnswerSummarySource = Readonly<{
  submissionId: string;
  audienceName: string;
  quote: string;
}>;

export type ReleaseAnswerSummaryPhase = Readonly<{
  phaseIndex: number;
  phaseLabel: string;
  /** Current formal revisions with written text: what a summary could read. */
  answerCount: number;
  canSummarize: boolean;
  latest: Readonly<{
    id: string;
    createdAt: string;
    summary: string;
    basisCount: number;
    /** Answers submitted or resubmitted since this summary was made. */
    changedSinceCount: number;
    themes: readonly Readonly<{
      kind: AnswerThemeKind;
      statement: string;
      sources: readonly AnswerSummarySource[];
    }>[];
  }> | null;
}>;

type LoadedPhase = Readonly<{
  phaseIndex: number;
  phaseLabel: string;
  requirement: { action: string; evidence: string[] };
  answers: (AnswerForThemes & { audienceName: string; submittedAt: Date })[];
}>;

/**
 * One loader for both reads, so "what a summary could read" on the page is
 * exactly what the model is then given. Authorization matches the roster: the
 * actor published the release and still manages its classroom.
 */
async function loadPhases(
  database: PrismaClient,
  actorId: string,
  releaseId: string,
): Promise<{ title: string; phases: LoadedPhase[] } | null> {
  const row = await database.activityRelease.findFirst({
    where: {
      id: releaseId,
      publisherId: actorId,
      classroom: { managerId: actorId },
    },
    select: {
      executionVersion: true,
      snapshot: { select: { content: true } },
      submissions: {
        where: { latestRevisionNumber: { gt: 0 } },
        select: {
          id: true,
          phaseIndex: true,
          latestRevisionNumber: true,
          student: { select: { displayName: true } },
          group: { select: { name: true } },
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: {
              id: true,
              revisionNumber: true,
              textEvidence: true,
              submittedAt: true,
            },
          },
        },
      },
    },
  });
  if (!row?.snapshot) return null;

  const content = activityContentSchema.parse(row.snapshot.content);
  const phased =
    row.executionVersion === 1 &&
    isStructuredContent(content) &&
    content.submissionMode !== "once";
  const wholeTask =
    !phased || (isStructuredContent(content) && content.submissionMode === "mixed");

  const slots: Omit<LoadedPhase, "answers">[] = [
    ...(phased && isStructuredContent(content)
      ? content.phases.map((phase, index) => ({
          phaseIndex: index + 1,
          phaseLabel: phase.name,
          requirement: {
            action: phase.action,
            evidence: phase.evidence.map((evidence) => evidence.description),
          },
        }))
      : []),
    ...(wholeTask
      ? [
          {
            phaseIndex: 0,
            phaseLabel: phased ? "整项终稿" : "整项提交",
            requirement: {
              action: content.taskInstructions,
              evidence: isStructuredContent(content)
                ? content.phases.flatMap((phase) =>
                    phase.evidence.map((evidence) => evidence.description),
                  )
                : [...content.evidenceRequirements],
            },
          },
        ]
      : []),
  ];

  return {
    title: content.title,
    phases: slots.map((slot) => ({
      ...slot,
      answers: row.submissions
        .flatMap((submission) => {
          const current = submission.revisions[0];
          if (
            submission.phaseIndex !== slot.phaseIndex ||
            !current ||
            current.revisionNumber !== submission.latestRevisionNumber ||
            current.textEvidence.trim() === ""
          ) {
            return [];
          }
          return [
            {
              submissionId: submission.id,
              revisionId: current.id,
              text: current.textEvidence,
              audienceName:
                submission.group?.name ??
                submission.student?.displayName ??
                "已不在班级的学生",
              submittedAt: current.submittedAt,
            },
          ];
        })
        // Newest first, so a very large class is cut to its latest answers;
        // the id keeps the order stable between the page and the model call.
        .sort(
          (left, right) =>
            right.submittedAt.getTime() - left.submittedAt.getTime() ||
            left.submissionId.localeCompare(right.submissionId),
        )
        .slice(0, ANSWER_THEMES_MAX_ANSWERS),
    })),
  };
}

/** The answers the model will read for one phase, without any names. */
export async function getReleaseAnswerBasis(
  database: PrismaClient,
  commandContext: CommandContext,
  rawInput: unknown,
): Promise<ReleaseAnswerBasis | null> {
  const input = basisInputSchema.parse(rawInput);
  const context = resolveCommandContext(commandContext, ["UI"]);
  const loaded = await loadPhases(database, context.actorId, input.releaseId);
  const phase = loaded?.phases.find((item) => item.phaseIndex === input.phaseIndex);
  if (!loaded || !phase) return null;
  return {
    releaseTitle: loaded.title,
    phaseLabel: phase.phaseLabel,
    requirement: phase.requirement,
    answers: phase.answers.map((answer) => ({
      submissionId: answer.submissionId,
      revisionId: answer.revisionId,
      text: answer.text,
    })),
  };
}

/**
 * Each phase's latest saved summary, with quotes attributed to whoever wrote
 * them. Names are resolved now, from the release as the teacher may see it
 * today; the stored record only holds ids.
 */
export async function getReleaseAnswerSummaries(
  database: PrismaClient,
  commandContext: CommandContext,
  releaseId: string,
): Promise<ReleaseAnswerSummaryPhase[] | null> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const loaded = await loadPhases(database, context.actorId, z.uuid().parse(releaseId));
  if (!loaded) return null;

  const stored = await database.releaseAnswerSummary.findMany({
    where: { releaseId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      phaseIndex: true,
      summary: true,
      themes: true,
      basisRevisionIds: true,
      createdAt: true,
    },
  });
  const names = await database.submission.findMany({
    where: { releaseId },
    select: {
      id: true,
      student: { select: { displayName: true } },
      group: { select: { name: true } },
    },
  });
  const nameOf = new Map(
    names.map((submission) => [
      submission.id,
      submission.group?.name ?? submission.student?.displayName ?? "已不在班级的学生",
    ]),
  );

  return loaded.phases.map((phase) => {
    const latest = stored.find((summary) => summary.phaseIndex === phase.phaseIndex);
    const basis = new Set(latest?.basisRevisionIds ?? []);
    return {
      phaseIndex: phase.phaseIndex,
      phaseLabel: phase.phaseLabel,
      answerCount: phase.answers.length,
      canSummarize: phase.answers.length >= ANSWER_THEMES_MIN_ANSWERS,
      latest: latest
        ? {
            id: latest.id,
            createdAt: latest.createdAt.toISOString(),
            summary: latest.summary,
            basisCount: basis.size,
            changedSinceCount: phase.answers.filter(
              (answer) => !basis.has(answer.revisionId),
            ).length,
            themes: storedAnswerThemesSchema.parse(latest.themes).map((theme) => ({
              kind: theme.kind,
              statement: theme.statement,
              sources: theme.sources.map((source) => ({
                submissionId: source.submissionId,
                audienceName: nameOf.get(source.submissionId) ?? "已不在班级的学生",
                quote: source.quote,
              })),
            })),
          }
        : null,
    };
  });
}
