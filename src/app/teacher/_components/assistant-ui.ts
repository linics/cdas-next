/**
 * 教研助手（整页与右下角浮层两种形态）的版式。
 * 根节点带 group/assistant 与 data-surface；浮层形态下的差异写成
 * group-data-[surface=panel]/assistant:… 。颜色只用主题 token。
 */
const panel = "group-data-[surface=panel]/assistant";

/** 行内操作与输入框底栏里的原生按钮：默认实心主按钮，data-tone=quiet 为描边按钮。 */
const nestedButtons = [
  "[&_button]:inline-flex [&_button]:h-8 [&_button]:items-center [&_button]:justify-center [&_button]:gap-1.5 [&_button]:rounded-md [&_button]:px-3 [&_button]:text-sm [&_button]:font-medium [&_button]:whitespace-nowrap [&_button]:transition-all",
  "[&_button]:bg-primary [&_button]:text-primary-foreground [&_button:hover:not(:disabled)]:bg-primary/90",
  "[&_button[data-tone=quiet]]:border [&_button[data-tone=quiet]]:border-border [&_button[data-tone=quiet]]:bg-background [&_button[data-tone=quiet]]:text-foreground [&_button[data-tone=quiet]:hover:not(:disabled)]:bg-muted",
  "[&_button:active:not(:disabled)]:scale-[0.97] [&_button:disabled]:cursor-wait [&_button:disabled]:opacity-50",
  "[&_button:focus-visible]:ring-[3px] [&_button:focus-visible]:ring-ring/50 [&_button:focus-visible]:outline-none",
].join(" ");

const resultBox = `mt-3 flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_a]:font-medium [&_a]:underline-offset-4 [&_a:hover]:underline`;

export const styles = {
  assistant: `group/assistant mx-auto grid w-full max-w-5xl gap-4 px-0 pb-8 data-[surface=panel]:h-full data-[surface=panel]:min-h-0 data-[surface=panel]:grid-rows-[minmax(0,1fr)_auto] data-[surface=panel]:gap-2 data-[surface=panel]:p-3`,
  conversation: `grid content-start gap-3 ${panel}:min-h-0 ${panel}:overflow-x-hidden ${panel}:overflow-y-auto ${panel}:overscroll-contain ${panel}:px-1`,
  header: `flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end sm:justify-between [&_h2]:text-xl [&_h2]:font-semibold ${panel}:flex-row ${panel}:items-center ${panel}:border-t-0 ${panel}:pt-0 ${panel}:[&_h2]:text-base`,
  eyebrow: "text-xs font-medium text-muted-foreground",
  speaker: "text-xs font-medium text-muted-foreground",
  availability:
    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs whitespace-nowrap text-muted-foreground before:size-1.5 before:rounded-full before:bg-status-done-foreground before:content-[''] data-[busy=true]:before:animate-pulse data-[busy=true]:before:bg-foreground",
  boundaryNote: `rounded-lg border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground [&_a]:ml-1 [&_a]:font-medium [&_a]:text-foreground [&_a]:underline-offset-4 [&_a:hover]:underline ${panel}:px-3 ${panel}:py-2 ${panel}:text-xs`,
  emptyPrompt: `rounded-lg border border-dashed px-4 py-3 text-sm leading-relaxed text-muted-foreground ${panel}:border-0 ${panel}:p-0`,
  transcript: "grid",
  turn: `grid grid-cols-1 gap-2 py-4 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-4 [&+&]:border-t ${panel}:grid-cols-1 ${panel}:gap-1 ${panel}:py-3 ${panel}:[&+&]:border-t-0`,
  turnBody: "min-w-0 [&>p]:text-sm [&>p]:leading-7 [&>p]:whitespace-pre-wrap",
  toolProgress: "text-sm leading-7 whitespace-pre-wrap text-muted-foreground",
  errorText: "text-sm leading-7 font-medium whitespace-pre-wrap text-destructive",
  toolResult: `${resultBox} [&_strong]:font-semibold [&>a]:text-sm`,
  knowledgeResult: `${resultBox} [&_summary]:cursor-pointer [&_summary]:font-medium [&>p]:whitespace-pre-wrap`,
  approval: `${resultBox} [&>strong]:font-semibold [&_dl]:grid [&_dl]:grid-cols-1 [&_dl]:gap-3 sm:[&_dl]:grid-cols-3 ${panel}:[&_dl]:grid-cols-1 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:mt-0.5 [&_dd]:font-medium`,
  proposalSummary: `my-3 grid! grid-cols-1! gap-3 sm:grid-cols-2! ${panel}:grid-cols-1! [&>div]:border-t [&>div]:pt-2`,
  proposalSection:
    "mt-3 [&_h3]:mb-2 [&_h3]:text-xs [&_h3]:font-semibold [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1.5 [&_ul]:pl-4 [&_ul]:text-xs [&_ul]:leading-relaxed [&_ul]:text-muted-foreground [&_dl]:grid-cols-1! [&_dl]:gap-2 [&_dd]:text-xs [&_dd]:font-normal [&_dd]:leading-relaxed",
  referenceList:
    "mt-2 grid list-decimal gap-2 pl-4 text-sm [&_summary]:cursor-pointer [&_summary]:text-sm [&_a]:font-medium [&_a]:underline-offset-4 [&_a:hover]:underline [&_li>p]:mt-1",
  referenceCaveat: "mb-0 text-xs text-muted-foreground",
  sourceMeta: "mt-2 mb-1 text-xs text-muted-foreground",
  sourceExcerpt:
    "mb-2 border-l-2 py-1 pl-3 text-sm leading-7 text-foreground/80",
  inlineActions: `mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap [&_a]:text-sm [&_a]:font-medium [&_a]:underline-offset-4 [&_a:hover]:underline ${nestedButtons} ${panel}:flex-col ${panel}:[&_button]:w-full`,

  // 输入框
  composer: `grid gap-2 border-t pt-4 [&_label]:text-sm [&_label]:font-medium ${panel}:gap-1 ${panel}:pt-2`,
  composerField: `grid rounded-lg border border-input shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 [&_textarea]:min-h-28 [&_textarea]:w-full [&_textarea]:resize-none [&_textarea]:bg-transparent [&_textarea]:px-3 [&_textarea]:pt-3 [&_textarea]:text-sm [&_textarea]:leading-relaxed [&_textarea]:outline-none ${panel}:[&_textarea]:min-h-12 ${panel}:[&_textarea]:pt-2`,
  composerHiddenLabel: "sr-only",
  composerStatus: "text-xs text-muted-foreground",
  composerFooter: `flex flex-row items-center justify-between gap-2 px-2 pb-2 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-xs [&>span]:text-muted-foreground ${nestedButtons}`,
  composerActions: "ml-auto flex shrink-0 items-center gap-2",
  stopButton:
    "size-8! rounded-full! border! border-border! bg-background! p-0! text-foreground! hover:bg-muted! [&_svg]:size-3 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.7]",
} as const;
