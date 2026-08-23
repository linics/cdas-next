import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isClerkAuthenticationAvailable } from "../server/auth/clerk-availability";
import "./globals.css";

export const metadata: Metadata = {
  title: "CDAS Next",
  description: "跨学科学习活动工作台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const document = (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );

  return isClerkAuthenticationAvailable() ? (
    <ClerkProvider>{document}</ClerkProvider>
  ) : (
    document
  );
}
