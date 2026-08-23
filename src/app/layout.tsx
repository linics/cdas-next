import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { isClerkAuthenticationAvailable } from "../server/auth/clerk-availability";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "CDAS Next",
  description: "跨学科学习活动工作台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const document = (
    <html className={inter.variable} lang="zh-CN">
      <body className={inter.className}>{children}</body>
    </html>
  );

  return isClerkAuthenticationAvailable() ? (
    <ClerkProvider>{document}</ClerkProvider>
  ) : (
    document
  );
}
