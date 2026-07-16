import { ShoppingBag } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function ConsoleOrdersPage() {
  return (
    <ComingSoon
      title="Orders"
      subtitle="All customer orders and their fulfilment status."
      icon={ShoppingBag}
    />
  );
}
