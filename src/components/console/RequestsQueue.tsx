"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Inbox, Layers, XCircle, Clock } from "lucide-react";
import { useEscalationUpdates } from "@/hooks/useEscalationUpdates";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingRow } from "@/components/ui/Spinner";
import { buttonClass } from "@/components/ui/Button";
import { requestStatusView } from "@/components/ui/status";
import {
  Table,
  TableWrap,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui/Table";

type QueueItem = {
  supportRequestId: string;
  createdAt: string;
  requestStatus: string;
  message: string;
  customerName: string | null;
  actionType: string;
  actionDescription: string;
  policyReasons: string[];
  escalationId: string | null;
  escalationStatus: string | null;
  decidedByName: string | null;
};

type Kpis = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  auto_resolved: number;
};

type Filter = "pending" | "approved" | "rejected" | "auto_resolved" | "all";

async function fetchQueue(filter: Filter): Promise<{ items: QueueItem[]; kpis: Kpis }> {
  const res = await fetch(`/api/requests?filter=${filter}`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load queue");
  return res.json();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function RequestsQueue() {
  const [filter, setFilter] = useState<Filter>("pending");
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["queue", filter],
    queryFn: () => fetchQueue(filter),
  });
  useEscalationUpdates(() => qc.invalidateQueries({ queryKey: ["queue"] }));

  const items = data?.items ?? [];
  const k = data?.kpis;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requests"
        subtitle="Support requests triaged by the assistant and routed for review."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pending review" value={k?.pending ?? "—"} icon={Clock} />
        <StatCard label="Approved" value={k?.approved ?? "—"} icon={CheckCircle2} />
        <StatCard label="Rejected" value={k?.rejected ?? "—"} icon={XCircle} />
        <StatCard label="Auto-resolved" value={k?.auto_resolved ?? "—"} icon={Layers} />
      </div>

      <div className="overflow-x-auto">
        <FilterTabs<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: "Pending", count: k?.pending },
            { value: "approved", label: "Approved", count: k?.approved },
            { value: "rejected", label: "Rejected", count: k?.rejected },
            { value: "auto_resolved", label: "Auto-resolved", count: k?.auto_resolved },
            { value: "all", label: "All", count: k?.total },
          ]}
        />
      </div>

      <TableWrap>
        <Table>
          <Thead>
            <Tr>
              <Th>Received</Th>
              <Th>Customer</Th>
              <Th>Request</Th>
              <Th>Proposed action</Th>
              <Th>Status</Th>
              <Th className="text-right">Review</Th>
            </Tr>
          </Thead>
          <Tbody>
            {isLoading && <LoadingRow colSpan={6} />}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState
                    icon={Inbox}
                    title="Nothing here"
                    description="No requests match this filter."
                  />
                </td>
              </tr>
            )}
            {items.map((item) => {
              const s = requestStatusView(item);
              return (
                <Tr key={item.supportRequestId}>
                  <Td className="whitespace-nowrap text-gray-500">
                    {timeAgo(item.createdAt)}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={item.customerName} size={32} />
                      <span className="font-medium whitespace-nowrap text-gray-900">
                        {item.customerName ?? "Unknown"}
                      </span>
                    </div>
                  </Td>
                  <Td className="max-w-xs">
                    <span className="block truncate text-gray-600" title={item.message}>
                      {item.message}
                    </span>
                  </Td>
                  <Td>
                    <div className="text-gray-800">{item.actionDescription}</div>
                    {item.policyReasons.length > 0 && (
                      <div className="mt-0.5 text-xs text-gray-400">
                        {item.policyReasons.join(", ")}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                    {item.decidedByName && (
                      <div className="mt-1 text-xs text-gray-400">
                        by {item.decidedByName}
                      </div>
                    )}
                  </Td>
                  <Td className="text-right">
                    {item.escalationId && (
                      <Link
                        href={`/console/${item.escalationId}`}
                        className={buttonClass("secondary", "sm")}
                      >
                        {item.escalationStatus === "pending" ? "Review" : "View"}
                      </Link>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </TableWrap>
    </div>
  );
}
