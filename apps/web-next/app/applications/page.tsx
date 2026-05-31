import { KanbanSquare } from "lucide-react";

import { AppShell } from "@/app/components/AppShell";
import { Placeholder } from "@/app/components/Placeholder";

export default function ApplicationsPage() {
  return (
    <AppShell>
      <Placeholder
        icon={KanbanSquare}
        title="지원 현황"
        description="지원한 공고를 단계별로 관리하는 칸반 보드입니다. 다음 스토리에서 구현됩니다."
      />
    </AppShell>
  );
}
