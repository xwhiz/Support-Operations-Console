"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Banknote,
  CheckCircle2,
  CircleAlert,
  Clock,
  Inbox,
  Loader,
  RotateCcw,
  Timer,
  XCircle,
  Zap,
  ShoppingBag,
} from "lucide-react";
import { useEscalationUpdates } from "@/hooks/useEscalationUpdates";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { AreaChart } from "@/components/charts/AreaChart";
import { BarChart } from "@/components/charts/BarChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { CHART_COLORS, TONE_HEX } from "@/components/charts/common";
import { orderStatusLabel } from "@/lib/orderStatus";
import { formatMoney } from "@/lib/format";
import type { AnalyticsOverview } from "@/services/analytics";

async function fetchOverview(): Promise<AnalyticsOverview> {
  const res = await fetch("/api/analytics/overview", { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load analytics");
  return res.json();
}

const ESC_COLOR: Record<string, string> = {
  Pending: TONE_HEX.warning,
  Approved: TONE_HEX.success,
  Rejected: TONE_HEX.error,
};

export function ConsoleDashboard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: fetchOverview,
  });
  useEscalationUpdates(() =>
    qc.invalidateQueries({ queryKey: ["analytics"] }),
  );

  const k = data?.kpis;
  const dash = (v: React.ReactNode) => (isLoading ? "—" : v);

  // Every request lands in exactly one of these, so the cards sum to the total.
  // Zero buckets are hidden (they don't change the sum).
  const breakdown = k
    ? [
        { label: "Pending review", value: k.pendingEscalations, icon: Clock },
        { label: "Approved", value: k.approved, icon: CheckCircle2 },
        { label: "Rejected", value: k.rejected, icon: XCircle },
        { label: "Auto-resolved", value: k.autoResolved, icon: Zap },
        { label: "Auto-declined", value: k.autoDeclined, icon: Ban },
        { label: "In progress", value: k.inProgress, icon: Loader },
        { label: "Failed", value: k.failed, icon: CircleAlert },
      ].filter((b) => b.value > 0)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Operations overview across requests, decisions, and revenue."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total requests"
          value={dash(k?.totalRequests ?? 0)}
          icon={Inbox}
          hint={k ? "Sum of all states" : undefined}
        />
        {breakdown.map((b) => (
          <StatCard key={b.label} label={b.label} value={b.value} icon={b.icon} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total orders" value={dash(k?.totalOrders ?? 0)} icon={ShoppingBag} />
        <StatCard label="Revenue" value={dash(k ? formatMoney(k.totalRevenue) : "—")} icon={Banknote} />
        <StatCard label="Refunds issued" value={dash(k ? formatMoney(k.refundsIssued) : "—")} icon={RotateCcw} />
        <StatCard
          label="Avg decision time"
          value={dash(k?.avgTimeToDecisionHours != null ? `${k.avgTimeToDecisionHours}h` : "—")}
          icon={Timer}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartCard
          title="Requests over time"
          subtitle="Last 30 days"
          className="lg:col-span-2"
        >
          <AreaChart data={data?.requestsPerDay ?? []} name="Requests" />
        </ChartCard>
        <ChartCard title="Escalation status" subtitle="Reviewer decisions">
          <DonutChart
            size={200}
            centerLabel="escalations"
            data={(data?.byEscalationStatus ?? []).map((d) => ({
              name: d.name,
              value: d.value,
              color: ESC_COLOR[d.name] ?? TONE_HEX.gray,
            }))}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Requests by proposed action" subtitle="What the agent proposes">
          <BarChart
            data={(data?.byActionType ?? []).map((d) => ({
              label: orderStatusLabel(d.name),
              value: d.value,
            }))}
            color={CHART_COLORS[0]}
          />
        </ChartCard>
        <ChartCard title="Top escalation reasons" subtitle="Why requests need review">
          <BarChart
            data={(data?.byPolicyReason ?? []).slice(0, 6).map((d) => ({
              label: d.name.replace(/_/g, " "),
              value: d.value,
            }))}
            color={CHART_COLORS[1]}
          />
        </ChartCard>
      </div>
    </div>
  );
}
