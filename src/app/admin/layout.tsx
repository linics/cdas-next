import type { ReactNode } from "react";

/** The administrator route intentionally does not inherit the teacher layout,
 * so the teaching-only AI Agent can never mount here. */
export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
