import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "CDAS Next",
  description: "跨学科学习活动工作台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-scroll-behavior="smooth" lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
