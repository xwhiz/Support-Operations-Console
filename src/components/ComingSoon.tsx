import type { LucideIcon } from "lucide-react";
import { PageHeader } from "./ui/PageHeader";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";

/**
 * Temporary placeholder for sections that arrive in a later vertical of the
 * revamp, so the navigation is complete and never dead-ends.
 */
export function ComingSoon({
  title,
  subtitle,
  icon,
  note = "Coming online in this build",
  description = "This section is part of the ongoing revamp and will be wired up shortly.",
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  note?: string;
  description?: string;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={subtitle} />
      <Card padded={false}>
        <EmptyState icon={icon} title={note} description={description} />
      </Card>
    </div>
  );
}
