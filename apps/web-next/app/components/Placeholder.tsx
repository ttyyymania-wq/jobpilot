import type { LucideIcon } from "lucide-react";

export function Placeholder({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-jp-outline bg-jp-card">
        <Icon className="size-7 text-jp-blue" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-jp-fg-muted">
        {description}
      </p>
      <span className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-jp-outline bg-jp-surface px-3 py-1 text-xs font-medium text-jp-fg-muted">
        <span className="size-1.5 rounded-full bg-jp-warn" />
        준비중
      </span>
    </div>
  );
}
