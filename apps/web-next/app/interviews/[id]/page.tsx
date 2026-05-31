import { CalendarClock } from "lucide-react";

import { AppShell } from "@/app/components/AppShell";
import { Placeholder } from "@/app/components/Placeholder";

export default async function InterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <Placeholder
        icon={CalendarClock}
        title="면접 · 통근 상세"
        description={`면접 #${id} — 출발 권장 배너, 통근 멀티모달, 날씨, 캘린더 연동이 들어갈 화면입니다. 다음 스토리에서 구현됩니다.`}
      />
    </AppShell>
  );
}
