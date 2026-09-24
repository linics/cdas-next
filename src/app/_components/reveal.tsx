import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 进场动效：上移、淡入、去模糊（思路来自 Magic UI 的 BlurFade）。
 * 用纯 CSS 实现 —— 服务端渲染出来就开始播放，脚本慢或失败时内容照常可见；
 * 系统开启「减少动态效果」时不播放。delay 以秒计，用来做依次进场。
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("motion-safe:animate-reveal", className)}
      style={{ animationDelay: `${delay}s` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/**
 * 给页面内容容器用：直接子元素依次进场，每个间隔 60ms，第 5 个以后同时出现。
 */
export const revealChildren =
  "[&>*]:motion-safe:animate-reveal [&>*:nth-child(2)]:[animation-delay:60ms] [&>*:nth-child(3)]:[animation-delay:120ms] [&>*:nth-child(4)]:[animation-delay:180ms] [&>*:nth-child(n+5)]:[animation-delay:240ms]";
