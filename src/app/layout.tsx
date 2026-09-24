import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_SC } from "next/font/google";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./globals.css";

const geistSans = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

// 中文字形走 Noto Sans SC；拉丁字母与数字先落到 Geist。
const chineseFont = Noto_Sans_SC({
  display: "swap",
  preload: false,
  variable: "--font-cjk",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CDAS Next",
  description: "跨学科学习活动工作台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      className={cn(geistSans.variable, geistMono.variable, chineseFont.variable)}
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
