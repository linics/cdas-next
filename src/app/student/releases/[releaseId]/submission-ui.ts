import { buttonVariants } from "@/components/ui/button";
import { revealChildren } from "../../../_components/reveal";
import { cn } from "@/lib/utils";

/** shadcn 的按钮类要先合并冲突（基础类里的透明边框会盖掉描边色），和 <Button> 内部一致。 */
const button = (...args: Parameters<typeof buttonVariants>) =>
  cn(buttonVariants(...args));

/**
 * 学生活动页（页面、提交编辑器、附件编辑器）共用的版式。
 * 只用 Tailwind 语义类，颜色全部来自 globals.css 的主题 token；
 * 按钮直接取 shadcn 的 buttonVariants，和全站按钮保持一致。
 */
export const styles = {
  // 页面骨架
  releasePage: `mx-auto flex w-full max-w-4xl flex-col gap-6 ${revealChildren}`,
  backLink: `${button({ variant: "ghost", size: "sm" })} -ml-2 w-fit`,
  releaseHeader:
    "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between [&_h1]:type-page-title [&_p:last-child]:mt-1 [&_p:last-child]:text-sm [&_p:last-child]:text-muted-foreground",
  eyebrow: "text-xs font-medium text-muted-foreground",
  workspaceColumn: "flex flex-col gap-6",
  groupNotice:
    "flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border bg-muted/40 px-4 py-3 text-sm [&>strong]:font-semibold [&>span]:w-full [&>span]:text-xs [&>span]:text-muted-foreground",
  activityBackground:
    "flex flex-col gap-2 glass rounded-2xl p-5 text-base leading-7",

  // 任务书折叠
  releaseBrief:
    "group glass rounded-2xl [&[open]>summary]:border-b",
  briefHeading:
    "flex cursor-pointer items-center justify-between gap-3 px-5 py-3 text-sm font-medium",
  briefVersion: "text-xs font-normal text-muted-foreground",
  briefBody:
    "flex flex-col gap-5 p-5 text-sm leading-relaxed [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:space-y-3 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-3 [&_ul]:pl-5 [&_strong]:font-medium [&_p]:text-muted-foreground",

  // 阶段导航与当前阶段
  phaseNavigator:
    "grid auto-cols-fr grid-flow-col gap-2 overflow-x-auto [&>*]:flex [&>*]:min-w-32 [&>*]:flex-col [&>*]:gap-1 [&>*]:rounded-lg [&>*]:border [&>*]:bg-card [&>*]:p-3 [&>*]:text-sm [&>a]:transition-colors [&>a:hover]:bg-muted/60 [&>[data-current=true]]:border-primary [&>[data-current=true]]:ring-1 [&>[data-current=true]]:ring-primary [&>[data-locked=true]]:opacity-50 [&>[data-attention=true]]:border-status-resubmit-foreground/50 [&>[data-attention=true]]:bg-status-resubmit/60 [&_span:first-child]:flex [&_span:first-child]:size-6 [&_span:first-child]:items-center [&_span:first-child]:justify-center [&_span:first-child]:rounded-full [&_span:first-child]:bg-muted [&_span:first-child]:text-xs [&_strong]:font-medium [&_small]:text-xs [&_small]:text-muted-foreground",
  phaseFocus: "flex flex-col gap-3 glass rounded-2xl p-5",
  phaseFocusHeading:
    "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 [&_h2]:text-base [&_h2]:font-semibold",
  taskLine:
    "flex flex-col gap-0.5 text-sm leading-relaxed sm:flex-row sm:gap-3 [&>strong]:w-16 [&>strong]:shrink-0 [&>strong]:font-medium [&>strong]:text-muted-foreground data-[quiet=true]:text-muted-foreground",
  inlineDisclosure:
    "text-sm [&>summary]:w-fit [&>summary]:cursor-pointer [&>summary]:text-sm [&>summary]:font-medium [&>summary]:text-muted-foreground [&>summary:hover]:text-foreground",
  phaseStory: "text-base leading-7",
  phaseDue:
    "text-sm tabular-nums text-muted-foreground data-[late=true]:font-medium data-[late=true]:text-status-resubmit-foreground",

  // 编辑区
  editorSection:
    "flex flex-col gap-4 glass rounded-2xl p-5",
  sectionHeading:
    "flex items-start justify-between gap-3 [&_h2]:text-base [&_h2]:font-semibold",
  sectionLead: "text-sm text-muted-foreground",
  draftBadge:
    "inline-flex h-5 shrink-0 items-center rounded-4xl border px-2 text-xs font-medium",
  writerForm: "flex flex-col gap-4",
  writingField:
    "flex flex-col gap-2 [&>label]:text-sm [&>label]:font-medium",
  fieldMeta:
    "flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground",
  checkpointFieldset:
    "flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm [&_legend]:px-1 [&_legend]:text-xs [&_legend]:font-medium [&_legend]:text-muted-foreground [&_label]:flex [&_label]:items-start [&_label]:gap-2 [&_input]:mt-0.5 [&_input]:size-4 [&_input]:accent-primary [&_label_strong]:font-normal [&_label_small]:ml-2 [&_label_small]:text-xs [&_label_small]:text-muted-foreground",
  saveRow:
    "flex flex-col gap-3 border-t pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between",
  readOnlyEditor: "flex flex-col gap-3",
  readOnlyNotice:
    "rounded-lg border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground",
  resubmitSection: "flex flex-col gap-3",
  resubmitForm:
    "flex flex-col items-start gap-2 [&>p]:text-xs [&>p]:text-muted-foreground",
  commitArea: "flex flex-col gap-2 border-t pt-4",
  commitHint: "text-xs text-muted-foreground",
  primaryButton: button(),
  secondaryButton: button({ variant: "outline" }),
  ghostButton: `${button({ variant: "ghost", size: "sm" })} -ml-2 text-muted-foreground`,
  actionNotice:
    "flex flex-col gap-2 [&>button]:self-start [&>button]:text-sm [&>button]:font-medium [&>button]:underline [&>button]:underline-offset-4",
  visuallyHidden: "sr-only",

  // 附件
  attachmentEditor: "flex flex-col gap-3",
  attachmentHeading:
    "flex items-center justify-between gap-3 text-sm [&_h3]:font-medium [&>span]:text-xs [&>span]:text-muted-foreground",
  attachmentList: "flex flex-col gap-2",
  attachmentActions:
    "flex flex-wrap items-center gap-2 [&>button]:text-xs [&>button]:font-medium [&>button]:underline [&>button]:underline-offset-4 [&>a]:text-xs [&>a]:font-medium [&>a]:underline [&>a]:underline-offset-4",
  attachmentEmpty: "text-sm text-muted-foreground",
  attachmentPicker: `${button({ variant: "outline" })} w-fit cursor-pointer [&_input]:sr-only`,
  attachmentHelp: "text-xs text-muted-foreground",
  attachmentMessage: "text-sm text-muted-foreground",

  // 老师的反馈（页首）
  teacherResponse:
    "flex flex-col gap-3 rounded-2xl border bg-card p-5 data-[next-step=REVISE]:border-status-resubmit-foreground/40 data-[next-step=REVISE]:bg-status-resubmit/40",
  teacherResponseHeading:
    "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 [&_h2]:text-base [&_h2]:font-semibold [&>span]:text-xs [&>span]:text-muted-foreground",
  nextStepLine:
    "text-sm font-medium [&_a]:ml-2 [&_a]:underline [&_a]:underline-offset-4",

  // 提交历史
  historyDisclosure:
    "glass rounded-2xl [&>summary]:cursor-pointer [&>summary]:px-5 [&>summary]:py-3 [&>summary]:text-sm [&>summary]:font-medium [&[open]>summary]:border-b",
  historyHeading:
    "flex items-end justify-between gap-3 [&_h2]:type-section-title [&>span]:text-sm [&>span]:text-muted-foreground",
  emptyHistory:
    "rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground",
  revisionList: "flex flex-col divide-y px-5",
  revision: "flex flex-col gap-3 py-4 [&>h3]:text-sm [&>h3]:font-semibold",
  revisionNumber:
    "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums",
  revisionBadges:
    "flex gap-1.5 [&>span]:inline-flex [&>span]:h-5 [&>span]:items-center [&>span]:rounded-4xl [&>span]:border [&>span]:px-2 [&>span]:text-xs [&>span]:font-medium [&>span[data-late=true]]:border-transparent [&>span[data-late=true]]:bg-status-resubmit [&>span[data-late=true]]:text-status-resubmit-foreground",
  formalNote: "text-xs text-muted-foreground",
  revisionText:
    "rounded-lg border bg-background p-4 text-base leading-7 whitespace-pre-wrap",
  completedCheckpoints: "flex flex-col gap-1 text-sm text-muted-foreground",
  formalAttachmentList:
    "flex flex-col gap-2 text-sm [&>li]:flex [&>li]:flex-wrap [&>li]:items-center [&>li]:justify-between [&>li]:gap-3 [&>li]:rounded-lg [&>li]:border [&>li]:p-3 [&_li>div:first-child]:flex [&_li>div:first-child]:flex-col [&_li>div:first-child>span]:text-xs [&_li>div:first-child>span]:text-muted-foreground [&_strong]:font-medium",

  // 反馈与评价
  feedbackSection: "flex flex-col gap-3 border-t pt-4",
  feedbackHeading:
    "flex items-end justify-between gap-3 [&_h4]:text-sm [&_h4]:font-semibold [&>span]:text-xs [&>span]:text-muted-foreground",
  feedbackVersions: "flex flex-col gap-3",
  feedbackVersion:
    "flex flex-col gap-2 rounded-lg border p-3 data-[current=false]:opacity-70",
  feedbackVersionMeta:
    "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground [&>strong]:text-sm [&>strong]:font-medium [&>strong]:text-foreground [&>span]:rounded-4xl [&>span]:bg-primary [&>span]:px-2 [&>span]:text-primary-foreground",
  feedbackBody: "text-sm leading-relaxed whitespace-pre-wrap",
  feedbackStructure:
    "flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground",
  legacyFeedbackStructure: "text-xs text-muted-foreground",
  emptyFeedback: "text-sm text-muted-foreground",
  evaluationOutcomeList:
    "mb-2 flex flex-col divide-y rounded-md border text-sm [&>li]:flex [&>li]:flex-wrap [&>li]:items-baseline [&>li]:gap-x-3 [&>li]:gap-y-1 [&>li]:p-2 [&_strong]:font-medium [&_li>span]:ml-auto [&_li>span]:font-medium [&_small]:w-full [&_small]:text-xs [&_small]:text-muted-foreground",
} as const;
