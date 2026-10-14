import type { ReactNode } from "react";
import { connection } from "next/server";
import { ZodError } from "zod";
import { AuthenticationError } from "../../server/auth/current-actor";
import { isActivityAssistantEnabled } from "../../server/assistant/assistant-config";
import {
  getTeacherAssistantClassrooms,
  TeacherAssistantContextError,
} from "../../server/assistant/teacher-assistant-context";
import { createUiCommandContext } from "../../server/commands/create-ui-command-context";
import { getDatabaseClient } from "../../server/db/client";
import { TeacherAgentOverlay } from "./_components/teacher-agent-overlay";
import {
  getAssistantConversation,
  restoreWindowStart,
} from "../../server/assistant/assistant-conversations";

function reportTeacherAgentContextFailure(error: unknown): void {
  console.error(
    "TEACHER_AGENT_CONTEXT_UNAVAILABLE",
    error instanceof Error ? error.name : "UNKNOWN_ERROR",
  );
}

export default async function TeacherLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await connection();
  let context;
  try {
    context = await createUiCommandContext();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return children;
    }
    throw error;
  }

  if (!isActivityAssistantEnabled()) {
    return children;
  }

  let classrooms;
  try {
    classrooms = await getTeacherAssistantClassrooms(
      getDatabaseClient(),
      context,
    );
  } catch (error) {
    if (
      !(error instanceof TeacherAssistantContextError) &&
      !(error instanceof ZodError)
    ) {
      reportTeacherAgentContextFailure(error);
    }
    return children;
  }

  // D-099: carry on with the latest conversation. Losing it only means a
  // fresh panel, so a failed read is reported and otherwise ignored.
  let initialConversation = null;
  try {
    initialConversation = await getAssistantConversation(getDatabaseClient(), context, {
      latestSince: restoreWindowStart(new Date()),
    });
  } catch (error) {
    reportTeacherAgentContextFailure(error);
  }

  return (
    <TeacherAgentOverlay classrooms={classrooms} initialConversation={initialConversation}>
      {children}
    </TeacherAgentOverlay>
  );
}
