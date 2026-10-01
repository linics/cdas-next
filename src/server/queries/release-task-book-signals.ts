import "server-only";

import { z } from "zod";
import {
  activityContentSchema,
  type ActivityContentV3,
} from "../../domain/activity/activity-content";
import { diagnosisTargets } from "../../domain/activity/draft-diagnosis";
import {
  buildTaskBookSignals,
  carryTaskBookSignals,
  type CarriedTaskBookSignal,
  type TaskBookSignal,
} from "../../domain/insights/task-book-signals";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  type CommandContext,
  resolveCommandContext,
} from "../commands/command-context";
import { getReleaseAnswerSummaries } from "./release-answer-summaries";
import { getTeacherReleaseDiagnosis } from "./teacher-release-diagnosis";

export type ReleaseTaskBookSignals = Readonly<{
  releaseId: string;
  title: string;
  classroomName: string;
  /** Null for older task books, which cannot be copied or diagnosed. */
  copySource: { id: string; version: number } | null;
  signals: readonly (TaskBookSignal & { sourceLabel: string })[];
}>;

async function loadReleaseSignals(
  database: PrismaClient,
  context: CommandContext,
  releaseId: string,
): Promise<(ReleaseTaskBookSignals & { content: ActivityContentV3 | null }) | null> {
  // Both reads authorize on their own (publisher who still manages the
  // classroom) and return null otherwise.
  const diagnosis = await getTeacherReleaseDiagnosis(database, context, { releaseId });
  const answerPhases = await getReleaseAnswerSummaries(database, context, releaseId);
  if (!diagnosis || !answerPhases) return null;
  const snapshot = await database.activityReleaseSnapshot.findUnique({
    where: { releaseId },
    select: { sourceDraftVersion: true, content: true },
  });
  if (!snapshot) return null;
  const content = activityContentSchema.parse(snapshot.content);
  if (content.schemaVersion !== 3) {
    return {
      releaseId,
      title: diagnosis.title,
      classroomName: diagnosis.classroomName,
      copySource: null,
      signals: [],
      content: null,
    };
  }
  const labels = new Map(
    diagnosisTargets(content).map((item) => [item.target, item.label]),
  );
  return {
    releaseId,
    title: diagnosis.title,
    classroomName: diagnosis.classroomName,
    copySource: { id: releaseId, version: snapshot.sourceDraftVersion },
    signals: buildTaskBookSignals(diagnosis, answerPhases).flatMap((signal) => {
      const sourceLabel =
        signal.target === "taskInstructions"
          ? "总体任务说明"
          : labels.get(signal.target);
      return sourceLabel ? [{ ...signal, sourceLabel }] : [];
    }),
    content,
  };
}

/** What a release's classroom data says about its own task book (D-088). */
export async function getReleaseTaskBookSignals(
  database: PrismaClient,
  commandContext: CommandContext,
  releaseId: string,
): Promise<ReleaseTaskBookSignals | null> {
  resolveCommandContext(commandContext, ["UI"]);
  const loaded = await loadReleaseSignals(
    database,
    commandContext,
    z.uuid().parse(releaseId),
  );
  if (!loaded) return null;
  return {
    releaseId: loaded.releaseId,
    title: loaded.title,
    classroomName: loaded.classroomName,
    copySource: loaded.copySource,
    signals: loaded.signals,
  };
}

export type DraftOriginSignals = Readonly<{
  releaseId: string;
  title: string;
  classroomName: string;
  signals: readonly CarriedTaskBookSignal[];
}>;

/**
 * The signals of the release a draft was copied from, carried onto the draft.
 *
 * Owning the copy is not enough: the classroom data belongs to the release, so
 * the teacher must still be its publisher and the classroom's manager. When
 * that has lapsed, or the draft was not copied from a release, this is null and
 * the draft page simply shows nothing.
 */
export async function getDraftOriginSignals(
  database: PrismaClient,
  commandContext: CommandContext,
  draftId: string,
): Promise<DraftOriginSignals | null> {
  const context = resolveCommandContext(commandContext, ["UI"]);
  const draft = await database.activityDraft.findFirst({
    where: { id: z.uuid().parse(draftId), ownerId: context.actorId },
    select: {
      schemaVersion: true,
      taskBook: true,
      origin: { select: { sourceReleaseId: true } },
    },
  });
  const releaseId = draft?.origin?.sourceReleaseId;
  if (!draft || !releaseId || draft.schemaVersion !== 3) return null;
  const loaded = await loadReleaseSignals(database, commandContext, releaseId);
  if (!loaded?.content) return null;
  const draftContent = activityContentSchema.parse(draft.taskBook);
  if (draftContent.schemaVersion !== 3) return null;
  return {
    releaseId: loaded.releaseId,
    title: loaded.title,
    classroomName: loaded.classroomName,
    signals: carryTaskBookSignals(loaded.signals, loaded.content, draftContent),
  };
}
