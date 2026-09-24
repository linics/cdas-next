import type { Metadata } from "next";
import { Geist_Mono, Noto_Sans_SC } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./globals.css";

const geistMono = Geist_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

// 全站唯一的界面字体：中文、拉丁字母和数字都出自思源黑体，字形一致。
// 只用 400 / 500 / 600 三个字重。
const chineseFont = Noto_Sans_SC({
  display: "swap",
  preload: false,
  variable: "--font-cjk",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "CDAS Next",
  description: "跨学科学习活动工作台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={cn(geistMono.variable, chineseFont.variable)}
      data-scroll-behavior="smooth"
      lang="zh-CN"
    >
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
