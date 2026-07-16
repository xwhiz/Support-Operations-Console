"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CheckCircle2,
  Clock,
  Inbox,
  RotateCcw,
  Timer,
  XCircle,
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

const usd = (v: string) =>
  `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Operations overview across requests, decisions, and revenue."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total requests" value={dash(k?.totalRequests ?? 0)} icon={Inbox} />
        <StatCard label="Pending review" value={dash(k?.pendingEscalations ?? 0)} icon={Clock} />
        <StatCard label="Approved" value={dash(k?.approved ?? 0)} icon={CheckCircle2} />
        <StatCard label="Rejected" value={dash(k?.rejected ?? 0)} icon={XCircle} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total orders" value={dash(k?.totalOrders ?? 0)} icon={ShoppingBag} />
        <StatCard label="Revenue" value={dash(k ? usd(k.totalRevenue) : "—")} icon={Banknote} />
        <StatCard label="Refunds issued" value={dash(k ? usd(k.refundsIssued) : "—")} icon={RotateCcw} />
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
