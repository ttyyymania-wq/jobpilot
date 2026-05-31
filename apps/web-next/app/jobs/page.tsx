import { Briefcase } from "lucide-react";

import { AppShell } from "@/app/components/AppShell";
import { Placeholder } from "@/app/components/Placeholder";

export default function JobsPage() {
  return (
    <AppShell>
      <Placeholder
        icon={Briefcase}
        title="공고 대시보드"
        description="이력서를 올리면 나와 맞는 채용 공고를 매칭해 보여줍니다. 다음 스토리에서 구현됩니다."
      />
    </AppShell>
  );
}
