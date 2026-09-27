import { cn } from "@/lib/utils";

/**
 * CDAS 标志（D-082）：三个互相重叠的圆 —— 几门学科在同一个活动里交汇，
 * 重叠越多越亮，正中实心的点是它们共同的成果。
 *
 * 不写死颜色：底块取 --primary，图形取 --primary-foreground，换配色时标志
 * 跟着变。需要单色时（打印、深色底），给 `tone="mono"`，整枚标志随当前文字色。
 */
export function BrandMark({
  className,
  tone = "tile",
}: {
  className?: string;
  tone?: "tile" | "mono";
}) {
  const tile = tone === "tile";
  return (
    <svg
      aria-hidden="true"
      className={cn("size-8 shrink-0", className)}
      fill="none"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      {tile ? (
        <rect fill="var(--primary)" height="32" rx="9" width="32" />
      ) : null}
      <g fill={tile ? "var(--primary-foreground)" : "currentColor"}>
        <circle cx="16" cy="11.6" opacity="0.5" r="6.4" />
        <circle cx="11.6" cy="19.2" opacity="0.5" r="6.4" />
        <circle cx="20.4" cy="19.2" opacity="0.5" r="6.4" />
        <circle cx="16" cy="16.7" r="1.9" />
      </g>
    </svg>
  );
}
