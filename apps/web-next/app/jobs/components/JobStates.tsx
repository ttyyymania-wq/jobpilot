import { AlertTriangle, RotateCw, SearchX, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** 공고 로딩 스켈레톤 — 카드 6개 shimmer. 그리드와 동일한 레이아웃. */
export function JobGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-4 rounded-xl border border-jp-outline bg-jp-card p-5"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="size-11 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <div className="flex gap-1.5">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** 빈 상태 — 이력서 없고 검색 전. */
export function JobEmptyState() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center rounded-xl border border-dashed border-jp-outline bg-jp-surface/40 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-jp-blue/15">
        <Sparkles className="size-6 text-jp-blue" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-jp-fg">
        이력서를 올리면 맞춤 공고를 점수와 함께
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-jp-fg-muted">
        왼쪽에 이력서를 올리면 스킬을 분석해 나와 맞는 공고를 매칭 점수와 함께
        보여드려요. 검색으로 먼저 둘러봐도 좋아요.
      </p>
    </div>
  );
}

/** 검색/필터 결과 없음. */
export function JobNoResults() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-jp-outline bg-jp-surface/40 px-6 py-12 text-center">
      <SearchX className="size-8 text-jp-fg-muted" />
      <p className="mt-4 text-sm font-medium text-jp-fg">
        조건에 맞는 공고가 없어요
      </p>
      <p className="mt-1 text-xs text-jp-fg-muted">
        검색어나 필터를 바꿔보세요.
      </p>
    </div>
  );
}

/** 에러 배너 + 재시도. */
export function JobErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-jp-red/30 bg-jp-red/10 px-6 py-12 text-center">
      <AlertTriangle className="size-8 text-jp-red" />
      <p className="mt-4 text-sm font-medium text-jp-fg">
        공고를 불러오지 못했어요
      </p>
      <p className="mt-1 max-w-sm text-xs text-jp-fg-muted">
        잠시 후 다시 시도해 주세요. 문제가 계속되면 네트워크를 확인하세요.
      </p>
      <Button size="sm" variant="outline" className="mt-5" onClick={onRetry}>
        <RotateCw className="size-4" />
        다시 시도
      </Button>
    </div>
  );
}
