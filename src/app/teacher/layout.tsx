import type { ReactNode } from "react";
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

function reportTeacherAgentContextFailure(error: unknown): void {
  console.error(
    "TEACHER_AGENT_CONTEXT_UNAVAILABLE",
    error instanceof Error ? error.name : "UNKNOWN_ERROR",
  );
}

export default async function TeacherLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
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

  return (
    <TeacherAgentOverlay classrooms={classrooms}>
      {children}
    </TeacherAgentOverlay>
  );
}
