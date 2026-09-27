import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * CDAS 标志（D-082）：三个互相重叠的圆环 —— 几门学科在同一个活动里交汇，
 * 重叠越多越亮；正中留出一圈空隙，里面是一颗四角星，表示它们共同得出的成果。
 *
 * 不写死颜色：底块是 --primary 的明暗渐变加一道玻璃高光，图形取
 * --primary-foreground，换配色时标志跟着变。需要单色时（打印、深色底），
 * 给 `tone="mono"`，没有底块，整枚标志随当前文字色。
 */
export function BrandMark({
  className,
  tone = "tile",
}: {
  className?: string;
  tone?: "tile" | "mono";
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tile = tone === "tile";
  const gradientId = `brand-tile-${id}`;
  const maskId = `brand-core-${id}`;
  return (
    <svg
      aria-hidden="true"
      className={cn("size-8 shrink-0", className)}
      fill="none"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {tile ? (
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
            <stop
              offset="0"
              style={{
                stopColor: "color-mix(in oklch, var(--primary), white 22%)",
              }}
            />
            <stop
              offset="1"
              style={{
                stopColor: "color-mix(in oklch, var(--primary), black 14%)",
              }}
            />
          </linearGradient>
        ) : null}
        {/* 圆环在中心让出一圈空隙，四角星不和线条挤在一起。 */}
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect fill="white" height="32" width="32" />
          <circle cx="16" cy="16.7" fill="black" r="3.3" />
        </mask>
      </defs>
      {tile ? (
        <>
          <rect fill={`url(#${gradientId})`} height="32" rx="9" width="32" />
          <rect
            height="31"
            rx="8.5"
            stroke="white"
            strokeOpacity="0.28"
            width="31"
            x="0.5"
            y="0.5"
          />
        </>
      ) : null}
      <g
        style={{ color: tile ? "var(--primary-foreground)" : undefined }}
        fill="currentColor"
      >
        <g
          mask={`url(#${maskId})`}
          stroke="currentColor"
          strokeOpacity="0.75"
          strokeWidth="0.9"
        >
          <circle cx="16" cy="11.2" fillOpacity="0.3" r="6.2" />
          <circle cx="11.1" cy="19.5" fillOpacity="0.3" r="6.2" />
          <circle cx="20.9" cy="19.5" fillOpacity="0.3" r="6.2" />
        </g>
        <path d="M16 12.9C16.4 15.7 17 16.3 19.8 16.7 17 17.1 16.4 17.7 16 20.5 15.6 17.7 15 17.1 12.2 16.7 15 16.3 15.6 15.7 16 12.9Z" />
      </g>
    </svg>
  );
}
