import {
  BookOpenIcon,
  ChartLineIcon,
  ClipboardListIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  PencilRulerIcon,
  type LucideIcon,
} from "lucide-react";

const iconByHref: Record<string, LucideIcon> = {
  "/teacher": LayoutDashboardIcon,
  "/teacher/activities": PencilRulerIcon,
  "/teacher/insights": ChartLineIcon,
  "/teacher/knowledge": BookOpenIcon,
  "/student": GraduationCapIcon,
  "/admin": LayoutDashboardIcon,
  "/admin/schools": BookOpenIcon,
  "/admin/teachers": ClipboardListIcon,
};

export function iconForNavigationHref(href: string): LucideIcon {
  return iconByHref[href] ?? ClipboardListIcon;
}
