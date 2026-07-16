"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Inbox, Plus, ShoppingBag, Wallet } from "lucide-react";
import { useEscalationUpdates } from "@/hooks/useEscalationUpdates";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { buttonClass } from "@/components/ui/Button";
import { ChartCard } from "@/components/charts/ChartCard";
import { AreaChart } from "@/components/charts/AreaChart";
import { DonutChart } from "@/components/charts/DonutChart";
import { TONE_HEX } from "@/components/charts/common";
import { orderStatusView, customerRequestStatusView } from "@/components/ui/status";
import type { PortalOverview } from "@/services/analytics";

async function fetchOverview(): Promise<PortalOverview> {
  const res = await fetch("/api/portal/overview", { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load overview");
  return res.json();
}

const usd = (v: string) =>
  `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PortalDashboard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["portal-overview"],
    queryFn: fetchOverview,
  });
  useEscalationUpdates(() =>
    qc.invalidateQueries({ queryKey: ["portal-overview"] }),
  );

  const k = data?.kpis;
  const dash = (v: React.ReactNode) => (isLoading ? "—" : v);

  const orderSlices = (data?.ordersByStatus ?? []).map((d) => ({
    name: orderStatusView(d.name).label,
    value: d.value,
    color: TONE_HEX[orderStatusView(d.name).tone],
  }));
  const requestSlices = (data?.requestsByStatus ?? []).map((d) => ({
    name: customerRequestStatusView({ requestStatus: d.name }).label,
    value: d.value,
    color: TONE_HEX[customerRequestStatusView({ requestStatus: d.name }).tone],
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Your orders and support requests at a glance."
        actions={
          <Link href="/portal/orders" className={buttonClass("primary", "md")}>
            <Plus className="h-4 w-4" /> New order
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total orders" value={dash(k?.totalOrders ?? 0)} icon={ShoppingBag} />
        <StatCard label="Total spent" value={dash(k ? usd(k.totalSpend) : "—")} icon={Wallet} />
        <StatCard label="Open requests" value={dash(k?.openRequests ?? 0)} icon={Inbox} />
        <StatCard label="Resolved" value={dash(k?.resolvedRequests ?? 0)} icon={CheckCircle2} />
      </div>

      <ChartCard title="Orders over time" subtitle="Last 60 days">
        <AreaChart data={data?.ordersPerDay ?? []} name="Orders" height={240} />
      </ChartCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Orders by status" subtitle="Where your orders stand">
          <DonutChart size={200} centerLabel="orders" data={orderSlices} />
        </ChartCard>
        <ChartCard title="Requests by status" subtitle="Your support activity">
          <DonutChart size={200} centerLabel="requests" data={requestSlices} />
        </ChartCard>
      </div>
    </div>
  );
}
