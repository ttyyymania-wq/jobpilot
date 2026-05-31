"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/jobs", label: "공고" },
  { href: "/applications", label: "지원현황" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex min-h-dvh flex-col bg-jp-bg text-jp-fg">
      <header className="sticky top-0 z-40 h-14 border-b border-jp-outline bg-[color-mix(in_srgb,var(--jp-bg)_82%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          {/* Logo */}
          <Link
            href="/jobs"
            className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight transition-opacity hover:opacity-80"
          >
            <span className="text-base">🧭</span>
            <span>
              Job<span className="text-jp-blue">Pilot</span>
            </span>
          </Link>

          {/* Center tabs */}
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 sm:flex">
            {TABS.map((tab) => {
              const active =
                pathname === tab.href || pathname.startsWith(tab.href + "/");
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "relative px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "text-jp-fg"
                      : "text-jp-fg-muted hover:text-jp-fg",
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      "absolute inset-x-2 -bottom-[11px] h-0.5 rounded-full bg-jp-blue transition-all duration-200",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          {/* Right action */}
          <Button size="sm" className="shrink-0 font-medium">
            <Upload className="size-4" />
            <span className="hidden sm:inline">이력서 업로드</span>
            <span className="sm:hidden">업로드</span>
          </Button>
        </div>

        {/* Mobile tabs row */}
        <nav className="flex h-0 items-center" aria-hidden />
      </header>

      {/* Mobile tab bar (below header) */}
      <nav className="flex items-center gap-1 border-b border-jp-outline px-4 py-1.5 sm:hidden">
        {TABS.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "text-jp-fg" : "text-jp-fg-muted",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-jp-blue transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
            </Link>
          );
        })}
      </nav>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>

      {/* AI FAB */}
      <button
        type="button"
        onClick={() => router.push("/assistant")}
        aria-label="AI 어시스턴트 열기"
        className="jp-fab-glow fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-jp-blue text-white transition-all duration-200 hover:bg-jp-blue-hover hover:scale-105 active:scale-95"
      >
        <Bot className="size-6" />
      </button>
    </div>
  );
}
