/**
 * 全站背景的极光色雾：四团大面积、低饱和、重度模糊的色块缓慢漂移。
 * 只作氛围，不承载信息；颜色来自 globals.css 的 --aurora-*。
 * 系统开启「减少动态效果」时静止。纯 CSS，不依赖脚本。
 */
export function AuroraBackground() {
  return (
    <div
      aria-hidden="true"
      data-print="hide"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      <div className="absolute -top-[18vw] -left-[10vw] size-[54vw] rounded-full bg-(--aurora-1) opacity-80 blur-[90px] motion-safe:animate-aurora-drift-1" />
      <div className="absolute top-[8vh] -right-[12vw] size-[46vw] rounded-full bg-(--aurora-2) opacity-80 blur-[90px] motion-safe:animate-aurora-drift-2" />
      <div className="absolute -bottom-[24vw] left-[20vw] h-[42vw] w-[52vw] rounded-full bg-(--aurora-3) opacity-80 blur-[90px] motion-safe:animate-aurora-drift-3" />
      <div className="absolute top-[38vh] left-[38vw] size-[26vw] rounded-full bg-(--aurora-4) opacity-60 blur-[80px] motion-safe:animate-aurora-drift-2" />
    </div>
  );
}
