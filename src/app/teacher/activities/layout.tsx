import type { ReactNode } from "react";

import { ActivityAssistantSessionProvider } from "../_components/activity-assistant";

export default function TeacherActivitiesLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <ActivityAssistantSessionProvider>{children}</ActivityAssistantSessionProvider>
  );
}
