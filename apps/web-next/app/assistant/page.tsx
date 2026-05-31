import { Sparkles } from "lucide-react";

import { AppShell } from "@/app/components/AppShell";
import { Placeholder } from "@/app/components/Placeholder";

export default function AssistantPage() {
  return (
    <AppShell>
      <Placeholder
        icon={Sparkles}
        title="AI 어시스턴트"
        description="필요한 화면을 실시간으로 생성하는 생성형 UI 어시스턴트입니다. 다음 스토리에서 구현됩니다."
      />
    </AppShell>
  );
}
