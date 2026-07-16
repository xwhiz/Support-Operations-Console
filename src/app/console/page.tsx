import { LayoutDashboard } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function ConsoleDashboardPage() {
  return (
    <ComingSoon
      title="Dashboard"
      subtitle="Operations overview across requests, decisions, and revenue."
      icon={LayoutDashboard}
    />
  );
}
