import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { isClerkAuthenticationAvailable } from "../server/auth/clerk-availability";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plus-jakarta",
});

export const metadata: Metadata = {
  title: "CDAS Next",
  description: "跨学科学习活动工作台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const document = (
    <html className={plusJakartaSans.variable} lang="zh-CN">
      <body className={plusJakartaSans.className}>{children}</body>
    </html>
  );

  return isClerkAuthenticationAvailable() ? (
    <ClerkProvider>{document}</ClerkProvider>
  ) : (
    document
  );
}
