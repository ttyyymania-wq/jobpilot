import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobPilot",
  description:
    "이력서 한 장으로 맞는 채용 공고를 찾고 면접 통근까지 챙겨주는 AI 채용 내비게이션. Built solo by channs.",
};

export const viewport: Viewport = {
  themeColor: "#0d1117",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark">
      <head>
        <link
          rel="stylesheet"
          as="style"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-dvh bg-jp-bg text-jp-fg antialiased">
        {children}
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
