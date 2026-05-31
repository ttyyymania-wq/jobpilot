"use client";

import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * 토글 칩 그룹. 클라이언트 사이드 다중 선택 필터.
 * 선택된 칩은 blue 강조, 그 외는 outline.
 */
export function FilterChips({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-jp-fg-muted">
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onToggle(opt.value)}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 active:scale-[0.97]",
                active
                  ? "border-jp-blue bg-jp-blue/15 text-jp-blue"
                  : "border-jp-outline bg-jp-surface text-jp-fg-muted hover:border-jp-fg-muted hover:text-jp-fg",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
