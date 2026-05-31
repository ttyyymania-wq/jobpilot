import { cn } from "@/lib/utils";

/**
 * 매칭 점수 뱃지. ≥80 success · 50–79 warn · 그 외 muted.
 * ● 도트 + 점수 수치 + 라벨로 시각적으로 강조한다.
 */
export function MatchScoreBadge({ score }: { score: number }) {
  const tier =
    score >= 80 ? "high" : score >= 50 ? "mid" : "low";

  const styles = {
    high: {
      wrap: "border-[var(--jp-success)]/30 bg-[var(--jp-success)]/12 text-[var(--jp-success)]",
      dot: "bg-[var(--jp-success)]",
      label: "강력 추천",
    },
    mid: {
      wrap: "border-[var(--jp-warn)]/30 bg-[var(--jp-warn)]/12 text-[var(--jp-warn)]",
      dot: "bg-[var(--jp-warn)]",
      label: "적합",
    },
    low: {
      wrap: "border-jp-outline bg-jp-surface text-jp-fg-muted",
      dot: "bg-jp-fg-muted",
      label: "참고",
    },
  }[tier];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums",
        styles.wrap,
      )}
      title={`매칭 점수 ${score}점`}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} />
      <span className="text-[13px] font-bold leading-none">{score}</span>
      <span className="font-medium opacity-80">{styles.label}</span>
    </span>
  );
}
