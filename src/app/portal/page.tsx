import { LayoutDashboard } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function PortalDashboardPage() {
  return (
    <ComingSoon
      title="Dashboard"
      subtitle="Your orders and requests at a glance."
      icon={LayoutDashboard}
    />
  );
}
