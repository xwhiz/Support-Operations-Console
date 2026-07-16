"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Inbox } from "lucide-react";
import { useEscalationUpdates } from "@/hooks/useEscalationUpdates";
import { PageHeader } from "@/components/ui/PageHeader";
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
  decision: string | null;
  actionType: string;
  actionDescription: string;
  amount: string | null;
  policyReasons: string[];
  escalationId: string | null;
  escalationStatus: string | null;
  decidedByName: string | null;
};

type Filter = "needs_review" | "all";

async function fetchQueue(filter: Filter): Promise<QueueItem[]> {
  const res = await fetch(`/api/requests?filter=${filter}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("failed to load queue");
  return (await res.json()).items as QueueItem[];
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
  const [filter, setFilter] = useState<Filter>("needs_review");
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["queue", filter],
    queryFn: () => fetchQueue(filter),
  });
  useEscalationUpdates(() => qc.invalidateQueries({ queryKey: ["queue"] }));

  const pendingCount = items.filter(
    (i) => i.escalationStatus === "pending",
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requests"
        subtitle="Support requests triaged by the assistant and routed for review."
      />

      <FilterTabs<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          {
            value: "needs_review",
            label: "Needs review",
            count: filter === "needs_review" ? pendingCount : undefined,
          },
          { value: "all", label: "All activity" },
        ]}
      />

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
                    title={
                      filter === "needs_review"
                        ? "Nothing awaiting review"
                        : "No activity yet"
                    }
                    description={
                      filter === "needs_review"
                        ? "The queue is clear. New escalations will appear here."
                        : "Requests will show up here as customers submit them."
                    }
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
