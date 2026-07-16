import { ShoppingBag } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function PortalOrdersPage() {
  return (
    <ComingSoon
      title="Orders"
      subtitle="Create and track your orders."
      icon={ShoppingBag}
    />
  );
}
