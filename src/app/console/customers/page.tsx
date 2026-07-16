import { Users } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function ConsoleCustomersPage() {
  return (
    <ComingSoon
      title="Customers"
      subtitle="Revenue, orders, and support activity per customer."
      icon={Users}
    />
  );
}
