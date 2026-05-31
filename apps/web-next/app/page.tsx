import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-jp-bg text-jp-fg">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-jp-blue/15 blur-[140px]"
      />

      {/* Top bar */}
      <header className="flex h-14 items-center justify-between px-6 sm:px-10">
        <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span>🧭</span>
          Job<span className="text-jp-blue">Pilot</span>
        </span>
        <Button asChild variant="outline" size="sm">
          <Link href="/jobs">서비스 시작</Link>
        </Button>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-jp-outline bg-jp-surface px-4 py-1.5 text-xs font-medium text-jp-fg-muted">
          <Compass className="size-3.5 text-jp-blue" />
          채용부터 면접 통근까지, 한 번에
        </span>

        <h1 className="max-w-2xl text-balance text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
          이력서 한 장으로
          <br />
          <span className="text-jp-blue">맞는 공고</span>를 찾고
          <br />
          면접까지 데려다줍니다
        </h1>

        <p className="mt-6 max-w-lg text-balance text-base leading-relaxed text-jp-fg-muted sm:text-lg">
          AI가 공고를 매칭하고, 면접 날 출발 시각과 통근 경로, 날씨까지 챙겨주는
          채용 내비게이션.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="font-medium">
            <Link href="/jobs">
              공고 둘러보기
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="font-medium">
            <Link href="/assistant">AI 어시스턴트</Link>
          </Button>
        </div>
      </main>

      {/* Credit footer */}
      <footer className="px-6 py-8 text-center text-sm text-jp-fg-muted">
        JobPilot — built solo by{" "}
        <span className="font-medium text-jp-fg">channs</span>
      </footer>
    </div>
  );
}
