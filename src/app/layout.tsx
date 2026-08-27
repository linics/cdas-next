import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Cormorant_Garamond, Lora, Noto_Serif_SC } from "next/font/google";
import type { ReactNode } from "react";
import { isClerkAuthenticationAvailable } from "../server/auth/clerk-availability";
import "./globals.css";

const displayFont = Cormorant_Garamond({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-heading-loaded",
  weight: ["400", "600"],
});

const bodyFont = Lora({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-body-loaded",
  weight: ["400", "600"],
});

const chineseFont = Noto_Serif_SC({
  display: "swap",
  preload: false,
  variable: "--font-cjk-loaded",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "CDAS Next",
  description: "跨学科学习活动工作台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const document = (
    <html
      className={`${displayFont.variable} ${bodyFont.variable} ${chineseFont.variable}`}
      data-scroll-behavior="smooth"
      lang="zh-CN"
    >
      <body>{children}</body>
    </html>
  );

  return isClerkAuthenticationAvailable() ? (
    <ClerkProvider>{document}</ClerkProvider>
  ) : (
    document
  );
}
