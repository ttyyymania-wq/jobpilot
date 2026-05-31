"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { extractFileText, sanitizeResumeText } from "@/lib/resume";
import type { ResumeProfile, ResumeResponse } from "@/lib/jobs";

type Phase = "idle" | "reading" | "parsing" | "done" | "error";

/**
 * 이력서 드롭존. PDF/txt/md 드래그&드롭 또는 클릭 업로드.
 * PDF는 pdfjs 로컬 워커로 텍스트 추출 → sanitize → POST /api/resume.
 * 파싱된 profile(skills 포함)을 부모로 올려보내 자동 매칭을 트리거한다.
 */
export function ResumeDropzone({
  onProfile,
  profile,
}: {
  onProfile: (profile: ResumeProfile) => void;
  profile: ResumeProfile | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    setPhase("reading");
    try {
      const raw = await extractFileText(file);
      if (raw === null) {
        setPhase("error");
        setError("PDF · TXT · MD 파일만 지원합니다.");
        return;
      }
      const text = sanitizeResumeText(raw);
      if (!text) {
        setPhase("error");
        setError("파일에서 텍스트를 추출하지 못했습니다.");
        return;
      }

      setPhase("parsing");
      const res = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`이력서 분석 실패 (${res.status})`);
      const data = (await res.json()) as ResumeResponse;
      if (!data.profile) {
        throw new Error(data.error ?? "이력서를 분석하지 못했습니다.");
      }

      setPhase("done");
      onProfile(data.profile);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    }
  }

  const busy = phase === "reading" || phase === "parsing";

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt,.md"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) void handleFile(f);
        }}
        disabled={busy}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-all duration-150",
          dragging
            ? "border-jp-blue bg-jp-blue/10"
            : "border-jp-outline bg-jp-surface hover:border-jp-blue/60 hover:bg-jp-card",
          busy && "cursor-wait opacity-80",
        )}
      >
        {busy ? (
          <>
            <Loader2 className="size-6 animate-spin text-jp-blue" />
            <span className="text-sm font-medium text-jp-fg">
              {phase === "reading" ? "파일 읽는 중…" : "이력서 분석 중…"}
            </span>
            {fileName && (
              <span className="max-w-full truncate text-xs text-jp-fg-muted">
                {fileName}
              </span>
            )}
          </>
        ) : phase === "done" && profile ? (
          <>
            <div className="flex size-10 items-center justify-center rounded-lg bg-jp-success/15">
              <FileText className="size-5 text-jp-success" />
            </div>
            <span className="text-sm font-medium text-jp-fg">
              {profile.name || "이력서"} 분석 완료
            </span>
            <span className="text-xs text-jp-blue">다른 파일로 교체</span>
          </>
        ) : (
          <>
            <div className="flex size-10 items-center justify-center rounded-lg bg-jp-blue/15">
              <Upload className="size-5 text-jp-blue" />
            </div>
            <span className="text-sm font-medium text-jp-fg">
              이력서 드래그 또는 클릭
            </span>
            <span className="text-xs text-jp-fg-muted">PDF · TXT · MD</span>
          </>
        )}
      </button>

      {phase === "error" && error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-jp-red/30 bg-jp-red/10 px-3 py-2 text-xs text-jp-red">
          <X className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Skill chips */}
      {profile && profile.skills.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-jp-fg-muted">
            <Sparkles className="size-3 text-jp-blue" />
            추출된 스킬
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.skills.map((skill) => (
              <Badge key={skill} variant="default">
                {skill}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
