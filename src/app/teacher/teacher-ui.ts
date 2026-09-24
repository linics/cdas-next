import { buttonVariants } from "@/components/ui/button";
import { revealChildren } from "../_components/reveal";
import { cn } from "@/lib/utils";

/** shadcn 的按钮类要先合并冲突（基础类里的透明边框会盖掉描边色），和 <Button> 内部一致。 */
const button = (...args: Parameters<typeof buttonVariants>) =>
  cn(buttonVariants(...args));

/**
 * 教师端各页面（活动设计、提交列表、班级名册、过程诊断、课程依据……）共用的版式。
 * 只用 Tailwind 语义类，颜色全部来自 globals.css 的主题 token；按钮取 shadcn 的
 * buttonVariants，表单控件套用与 shadcn Input/Textarea 相同的外观。
 */

/** 容器内的原生输入框、文本框、下拉框，统一成 shadcn Input 的样子。 */
const nestedControls = [
  "[&_input:not([type=checkbox]):not([type=radio]):not([type=hidden])]:h-9",
  "[&_input:not([type=checkbox]):not([type=radio])]:w-full",
  "[&_input:not([type=checkbox]):not([type=radio])]:rounded-md",
  "[&_input:not([type=checkbox]):not([type=radio])]:border",
  "[&_input:not([type=checkbox]):not([type=radio])]:border-input",
  "[&_input:not([type=checkbox]):not([type=radio])]:bg-transparent",
  "[&_input:not([type=checkbox]):not([type=radio])]:px-3",
  "[&_input:not([type=checkbox]):not([type=radio])]:text-sm",
  "[&_input:not([type=checkbox]):not([type=radio])]:shadow-xs",
  "[&_textarea]:min-h-24 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-transparent [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm [&_textarea]:leading-relaxed [&_textarea]:shadow-xs",
  "[&_select]:h-9 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-transparent [&_select]:px-3 [&_select]:text-sm [&_select]:shadow-xs",
  "[&_input:focus-visible]:border-ring [&_input:focus-visible]:ring-[3px] [&_input:focus-visible]:ring-ring/50 [&_input:focus-visible]:outline-none",
  "[&_textarea:focus-visible]:border-ring [&_textarea:focus-visible]:ring-[3px] [&_textarea:focus-visible]:ring-ring/50 [&_textarea:focus-visible]:outline-none",
  "[&_select:focus-visible]:border-ring [&_select:focus-visible]:ring-[3px] [&_select:focus-visible]:ring-ring/50 [&_select:focus-visible]:outline-none",
  "[&_input[type=checkbox]]:size-4 [&_input[type=checkbox]]:accent-primary [&_input[type=radio]]:size-4 [&_input[type=radio]]:accent-primary",
  "[&_:disabled]:cursor-not-allowed [&_:disabled]:opacity-50",
].join(" ");

const card = "rounded-xl border bg-card text-card-foreground shadow-xs";

export const styles = {
  // 页面骨架
  pageContent: `mx-auto flex w-full max-w-6xl flex-col gap-6 ${revealChildren}`,
  submissionPage: `mx-auto flex w-full max-w-6xl flex-col gap-6 ${revealChildren}`,
  pageHeader:
    "flex flex-col gap-4 md:flex-row md:items-end md:justify-between [&_h1]:type-page-title [&>div>p:last-child]:mt-1 [&>div>p:last-child]:max-w-2xl [&>div>p:last-child]:text-sm [&>div>p:last-child]:text-muted-foreground",
  pageHeaderActions: "flex shrink-0 flex-wrap gap-2",
  eyebrow: "text-xs font-medium text-muted-foreground",
  sectionHeader:
    "flex items-end justify-between gap-3 [&_h2]:type-section-title [&>span]:text-sm [&>span]:text-muted-foreground",
  dashboardBody: "flex flex-col gap-6",
  dashboardSection: `${card} flex flex-col gap-4 p-5`,
  emptyState:
    "rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground",
  configurationNote:
    "rounded-lg border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground",

  // 按钮与链接
  primaryButton: button(),
  primaryLink: button(),
  secondaryButton: button({ variant: "outline" }),
  dangerButton: button({ variant: "destructive" }),
  rowLink:
    "text-sm font-medium underline-offset-4 hover:underline",
  conflictLink: "text-sm font-medium underline underline-offset-4",

  // 状态标签：data-tone 映射到四档状态色
  statusBadge:
    "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-4xl border px-2 text-xs font-medium whitespace-nowrap data-[tone=attention]:border-transparent data-[tone=attention]:bg-status-pending data-[tone=attention]:text-status-pending-foreground data-[tone=next]:border-transparent data-[tone=next]:bg-status-resubmit data-[tone=next]:text-status-resubmit-foreground data-[tone=ready]:border-transparent data-[tone=ready]:bg-status-done data-[tone=ready]:text-status-done-foreground data-[tone=active]:border-transparent data-[tone=active]:bg-status-done data-[tone=active]:text-status-done-foreground data-[tone=sealed]:border-transparent data-[tone=sealed]:bg-status-closed data-[tone=sealed]:text-status-closed-foreground data-[tone=closed]:border-transparent data-[tone=closed]:bg-status-closed data-[tone=closed]:text-status-closed-foreground",

  // 活动列表
  activityList: "flex flex-col divide-y",
  nestedActivityRow:
    "grid grid-cols-1 items-center gap-1 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-4 sm:px-2",
  activityTitle: "text-sm font-medium",
  activityMeta: "text-xs text-muted-foreground tabular-nums",
  activityStatus: "flex justify-start sm:justify-end",

  // 提示条
  actionNotice:
    "flex items-center gap-3 rounded-lg border p-3 text-sm data-[status=error]:border-destructive/40 data-[status=error]:text-destructive data-[tone=error]:border-destructive/40 data-[tone=error]:text-destructive data-[status=conflict]:bg-status-resubmit data-[status=conflict]:text-status-resubmit-foreground data-[tone=conflict]:bg-status-resubmit data-[tone=conflict]:text-status-resubmit-foreground",
  actionStack: "flex flex-col gap-2 [&>*]:w-full",
  dialogDetail:
    "flex flex-col gap-3 text-sm [&_dl]:grid [&_dl]:grid-cols-2 [&_dl]:gap-2 [&_dl>div]:rounded-md [&_dl>div]:bg-muted [&_dl>div]:p-2 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:font-medium [&_dd]:text-foreground [&_code]:font-mono [&_code]:text-xs [&_code]:break-all",
  visuallyHidden: "sr-only",

  // 活动设计编辑器
  editorLayout:
    "grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]",
  previewLayout:
    "grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]",
  editorForm: "flex flex-col gap-6",
  editorRail: `${card} flex flex-col gap-3 p-5 lg:sticky lg:top-4 [&_h2]:text-base [&_h2]:font-semibold [&>p]:text-sm [&>p]:text-muted-foreground`,
  formSection: `${card} relative flex flex-col gap-4 p-5 [&_h2]:text-base [&_h2]:font-semibold`,
  formIndex:
    "text-xs text-muted-foreground tabular-nums",
  formField: `flex flex-col gap-2 [&>label:first-child]:text-sm [&>label:first-child]:font-medium [&>small]:text-xs [&>small]:text-muted-foreground ${nestedControls}`,
  taskGrid: `grid grid-cols-1 gap-4 sm:grid-cols-2 [&>label]:flex [&>label]:flex-col [&>label]:gap-2 [&>label]:text-sm [&>label]:font-medium ${nestedControls}`,
  taskFull: "sm:col-span-2",
  optionFieldset:
    "flex flex-col gap-3 rounded-lg border p-4 [&>legend]:px-1 [&>legend]:text-sm [&>legend]:font-medium",
  optionList:
    "flex flex-wrap gap-2 [&_label]:flex [&_label]:cursor-pointer [&_label]:items-center [&_label]:gap-2 [&_label]:rounded-md [&_label]:border [&_label]:px-3 [&_label]:py-1.5 [&_label]:text-sm [&_label]:transition-colors [&_label:hover]:bg-muted/60 [&_label:has(input:checked)]:border-primary [&_label:has(input:checked)]:bg-primary/5 [&_input]:size-4 [&_input]:accent-primary",
  phaseList: "flex flex-col gap-4",
  rubricList: "flex flex-col gap-4",
  phaseCard: `flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 [&>legend]:px-1 [&>legend]:text-sm [&>legend]:font-semibold ${nestedControls}`,
  rubricCard: `flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 [&>legend]:px-1 [&>legend]:text-sm [&>legend]:font-semibold ${nestedControls}`,

  // 预览与发布
  snapshotSheet: `${card} flex flex-col gap-6 p-6 text-sm leading-relaxed [&>header]:flex [&>header]:flex-col [&>header]:gap-2 [&>header]:border-b [&>header]:pb-4 [&>header_h2]:text-xl [&>header_h2]:font-semibold [&_section]:flex [&_section]:flex-col [&_section]:gap-2 [&_section_h3]:text-sm [&_section_h3]:font-semibold [&_section_p]:text-muted-foreground [&_ol]:list-decimal [&_ol]:space-y-3 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-3 [&_ul]:pl-5 [&_strong]:font-medium`,
  factTags:
    "flex flex-wrap gap-1.5 [&>span]:inline-flex [&>span]:h-6 [&>span]:items-center [&>span]:rounded-4xl [&>span]:bg-secondary [&>span]:px-2.5 [&>span]:text-xs [&>span]:text-secondary-foreground",
  publishRail: `${card} flex flex-col gap-3 p-5 lg:sticky lg:top-4 [&_h2]:text-base [&_h2]:font-semibold [&>p]:text-sm [&>p]:text-muted-foreground`,
  parameterForm: `flex flex-col gap-3 [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-sm [&_label]:font-medium [&_small]:text-xs [&_small]:font-normal [&_small]:text-muted-foreground ${nestedControls}`,
  legacyReadPanel: `${card} flex flex-col gap-5 p-6 text-sm leading-relaxed [&_h2]:type-section-title [&_h3]:font-semibold [&_p]:text-muted-foreground [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5`,

  // 提交列表
  progressSection: `${card} flex flex-col gap-4 p-5`,
  submissionList: "flex flex-col divide-y",
  submissionRow:
    "flex flex-col gap-2 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:px-2 [&_h2]:text-sm [&_h2]:font-medium [&_p]:text-xs [&_p]:text-muted-foreground",
  submissionMeta:
    "flex flex-wrap items-center gap-2 text-xs text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground [&_small]:text-xs",
  rowProgress:
    "flex items-center gap-2 text-xs tabular-nums text-muted-foreground",
  closeActivityPanel: `${card} flex flex-col gap-3 p-5 [&_h2]:text-base [&_h2]:font-semibold [&>p:not(:first-child)]:text-sm [&>p:not(:first-child)]:text-muted-foreground`,

  // 小组
  groupManager: `${card} flex flex-col gap-4 p-5`,
  groupManagerLead: "text-sm text-muted-foreground",
  groupCardList: "grid grid-cols-1 gap-3 md:grid-cols-2",
  groupCard:
    "flex flex-col gap-2 rounded-lg border p-4 data-[locked=true]:bg-muted/40 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:text-xs [&_p]:text-muted-foreground",
  groupCardActions: "mt-1 flex flex-wrap gap-2",
  groupEditor:
    "flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 [&>header]:flex [&>header]:items-center [&>header]:justify-between [&_h3]:text-sm [&_h3]:font-semibold",
  groupNameField: `flex flex-col gap-1.5 text-sm font-medium ${nestedControls}`,
  groupMemberFieldset: `flex flex-col gap-2 [&>legend]:mb-2 [&>legend]:text-sm [&>legend]:font-medium [&>div]:flex [&>div]:items-center [&>div]:gap-2 [&>div]:rounded-md [&>div]:border [&>div]:p-2 [&>div]:text-sm [&>div[data-unavailable=true]]:opacity-50 [&_small]:text-xs [&_small]:text-muted-foreground [&>p]:text-xs [&>p]:text-muted-foreground ${nestedControls}`,

  // 班级名册
  rosterLayout: "grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]",
  rosterImportPanel: `${card} flex flex-col gap-3 p-5 [&_h2]:text-base [&_h2]:font-semibold [&>p:not(:first-child)]:text-sm [&>p:not(:first-child)]:text-muted-foreground ${nestedControls}`,
  rosterList: "flex flex-col divide-y",
  rosterRow:
    "flex flex-wrap items-center justify-between gap-3 py-3 [&_h3]:text-sm [&_h3]:font-medium [&_p]:text-xs [&_p]:text-muted-foreground",
  rosterPreview:
    "flex flex-col gap-2 [&_h3]:text-sm [&_h3]:font-semibold [&>p]:text-xs [&>p]:text-muted-foreground [&_ul]:flex [&_ul]:max-h-64 [&_ul]:flex-col [&_ul]:divide-y [&_ul]:overflow-auto [&_ul]:rounded-md [&_ul]:border [&_li]:flex [&_li]:justify-between [&_li]:gap-2 [&_li]:p-2 [&_li]:text-sm [&_li:not([data-status=READY])]:text-destructive",
  importDisclosure:
    "rounded-lg border [&>summary]:cursor-pointer [&>summary]:px-4 [&>summary]:py-3 [&>summary]:text-sm [&>summary]:font-medium [&[open]>summary]:border-b",
  importDisclosureBody: `flex flex-col gap-3 p-4 text-sm ${nestedControls}`,
  importForm: `flex flex-col gap-3 ${nestedControls}`,
  importReport:
    "flex flex-col gap-1 rounded-lg bg-muted/50 p-3 text-sm",

  // 过程诊断
  insightsLayout: "mx-auto flex w-full max-w-6xl flex-col gap-6",
  filterForm: `flex flex-wrap items-end gap-3 [&_label]:flex [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-sm [&_label]:font-medium ${nestedControls}`,
  card: `${card} flex flex-col gap-4 p-5 [&_h2]:text-base [&_h2]:font-semibold`,
  cardLead: "text-sm text-muted-foreground",
  statGrid:
    "grid grid-cols-2 gap-3 md:grid-cols-4 [&>div]:rounded-lg [&>div]:border [&>div]:p-3 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:text-3xl [&_dd]:font-semibold [&_dd]:tabular-nums",
  releaseBlock:
    "flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0 [&>h3]:text-sm [&>h3]:font-semibold [&>p]:text-xs [&>p]:text-muted-foreground",
  stageList: "flex flex-col gap-4",
  stageRow: "grid gap-2",
  stageHead:
    "flex flex-wrap items-baseline justify-between gap-2 text-sm [&_strong]:font-medium [&>span]:text-xs [&>span]:tabular-nums [&>span]:text-muted-foreground",
  dimensionList: "flex flex-col gap-4",
  dimensionRow: "grid gap-2",
  dimensionHead:
    "flex flex-wrap items-baseline justify-between gap-2 text-sm [&_strong]:font-medium",
  // 堆叠条：优秀用主色实底，其余各档用浅底深字的状态色，保证条上的数字可读。
  barTrack: "flex min-h-6 w-full overflow-hidden rounded-md border bg-muted",
  barFill:
    "grid min-w-0 place-items-center text-xs font-medium tabular-nums [&+&]:border-l [&+&]:border-background data-[tone=excellent]:bg-primary data-[tone=excellent]:text-primary-foreground data-[tone=good]:bg-status-pending data-[tone=good]:text-status-pending-foreground data-[tone=pass]:bg-status-done data-[tone=pass]:text-status-done-foreground data-[tone=improve]:bg-status-resubmit data-[tone=improve]:text-status-resubmit-foreground data-[tone=insufficient]:bg-background data-[tone=insufficient]:text-muted-foreground data-[tone=stage]:bg-status-pending data-[tone=stage]:text-status-pending-foreground",
  weakMark:
    "inline-flex h-5 items-center rounded-4xl bg-status-resubmit px-2 text-xs font-medium text-status-resubmit-foreground",
  legend: "flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground",
  sampleNote: "text-xs text-muted-foreground",

  // 课程依据
  knowledgeLayout: "mx-auto flex w-full max-w-4xl flex-col gap-6",
  searchForm: `flex flex-wrap items-end gap-3 [&_label]:flex [&_label]:flex-1 [&_label]:flex-col [&_label]:gap-1.5 [&_label]:text-sm [&_label]:font-medium ${nestedControls}`,
  results: "flex flex-col gap-3",
  emptyResult:
    "rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground",
  sourceList: "flex flex-col gap-3",
  sourceSection: `${card} flex flex-col gap-2 p-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold`,
  sourceMeta: "flex flex-wrap gap-2 text-xs text-muted-foreground",
  sourceContent: "text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground",
} as const;
