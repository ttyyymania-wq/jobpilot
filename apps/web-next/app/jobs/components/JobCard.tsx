/* eslint-disable @next/next/no-img-element -- 임의의 외부 회사 로고 URL이라 next/image 최적화 대상이 아님 */
"use client";

import { useState } from "react";
import { Bot, Check, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  categoryLabel,
  workTypeLabel,
  type JobCardModel,
} from "@/lib/jobs";

import { MatchScoreBadge } from "./MatchScoreBadge";

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2);
}

export function JobCard({
  job,
  applied,
  onApply,
  onAssistant,
}: {
  job: JobCardModel;
  applied: boolean;
  onApply: (job: JobCardModel) => void;
  onAssistant: () => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const showLogo = job.companyLogo && !logoFailed;
  const cat = categoryLabel(job.category);
  const work = workTypeLabel(job.workType);

  return (
    <article
      className={cn(
        "group flex flex-col gap-4 rounded-xl border border-jp-outline bg-jp-card p-5",
        "transition-all duration-200 ease-out",
        "hover:-translate-y-1 hover:border-jp-blue hover:shadow-[0_12px_32px_-12px_rgba(59,130,246,0.45)]",
      )}
    >
      {/* Header: logo + title/company + match score */}
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-jp-outline bg-jp-surface">
          {showLogo ? (
            <img
              src={job.companyLogo}
              alt={job.company}
              className="size-full object-cover"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <span className="text-sm font-bold text-jp-fg-muted">
              {initials(job.company)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-snug text-jp-fg">
            {job.title || "제목 없음"}
          </h3>
          <p className="mt-0.5 truncate text-sm text-jp-fg-muted">
            {job.company || "회사 미상"}
          </p>
        </div>

        {job.matchScore !== null && (
          <MatchScoreBadge score={job.matchScore} />
        )}
      </div>

      {/* Subtitle */}
      {job.subtitle && (
        <p className="line-clamp-2 text-sm leading-relaxed text-jp-fg-muted">
          {job.subtitle}
        </p>
      )}

      {/* Tags */}
      {(cat || work) && (
        <div className="flex flex-wrap gap-1.5">
          {cat && <Badge variant="secondary">{cat}</Badge>}
          {work && (
            <Badge variant="outline" className="gap-1">
              <MapPin className="size-3" />
              {work}
            </Badge>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant={applied ? "secondary" : "default"}
          className="flex-1"
          onClick={() => onApply(job)}
          aria-pressed={applied}
        >
          {applied ? (
            <>
              <Check className="size-4" />
              지원함
            </>
          ) : (
            "지원하기"
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAssistant()}
          aria-label="AI 어시스턴트에게 물어보기"
        >
          <Bot className="size-4" />
          AI
        </Button>
      </div>
    </article>
  );
}
