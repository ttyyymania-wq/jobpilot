"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 검색바. 입력을 300ms 디바운스해 onSearch 로 흘려보낸다.
 * 좌측 🔎 아이콘 + 우측 클리어 버튼.
 */
export function SearchBar({
  onSearch,
  placeholder = "직무, 회사, 기술 검색…",
}: {
  onSearch: (query: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(value.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, onSearch]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-jp-fg-muted" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label="공고 검색"
        className={cn("h-11 pl-9", value && "pr-9")}
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="검색어 지우기"
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-jp-fg-muted transition-colors hover:bg-jp-surface hover:text-jp-fg"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
