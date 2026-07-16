"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useEscalationUpdates } from "@/hooks/useEscalationUpdates";

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
  const res = await fetch(`/api/requests?filter=${filter}`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load queue");
  return (await res.json()).items as QueueItem[];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function StatusBadge({ item }: { item: QueueItem }) {
  let label: string;
  let cls: string;
  if (item.escalationStatus === "pending") {
    label = "Needs review";
    cls = "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  } else if (item.escalationStatus === "executed") {
    label = "Approved";
    cls = "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
  } else if (item.escalationStatus === "rejected") {
    label = "Rejected";
    cls = "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  } else if (item.requestStatus === "auto_resolved") {
    label = "Auto-resolved";
    cls = "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
  } else if (item.requestStatus === "rejected") {
    label = "Auto-declined";
    cls = "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200";
  } else {
    label = item.requestStatus;
    cls = "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200";
  }
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export function QueueClient() {
  const [filter, setFilter] = useState<Filter>("needs_review");
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["queue", filter],
    queryFn: () => fetchQueue(filter),
  });

  useEscalationUpdates(() => qc.invalidateQueries({ queryKey: ["queue"] }));

  const pendingCount = items.filter((i) => i.escalationStatus === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Support queue</h1>
        <div className="flex gap-1 rounded-md border border-neutral-300 p-0.5 text-sm dark:border-neutral-700">
          <button
            onClick={() => setFilter("needs_review")}
            className={`rounded px-3 py-1 ${filter === "needs_review" ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-600 dark:text-neutral-300"}`}
          >
            Needs review{filter === "needs_review" && pendingCount ? ` (${pendingCount})` : ""}
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`rounded px-3 py-1 ${filter === "all" ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-600 dark:text-neutral-300"}`}
          >
            All activity
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
            <tr>
              <th className="px-4 py-2">Received</th>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Request</th>
              <th className="px-4 py-2">Proposed action</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">Loading…</td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  {filter === "needs_review" ? "Nothing awaiting review 🎉" : "No activity yet."}
                </td>
              </tr>
            )}
            {items.map((item) => (
              <tr key={item.supportRequestId} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{relativeTime(item.createdAt)}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.customerName}</td>
                <td className="max-w-xs truncate px-4 py-3 text-neutral-600 dark:text-neutral-300" title={item.message}>{item.message}</td>
                <td className="px-4 py-3">
                  <div className="text-neutral-800 dark:text-neutral-100">{item.actionDescription}</div>
                  {item.policyReasons.length > 0 && (
                    <div className="mt-0.5 text-xs text-neutral-400">{item.policyReasons.join(", ")}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge item={item} />
                  {item.decidedByName && (
                    <div className="mt-0.5 text-xs text-neutral-400">by {item.decidedByName}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {item.escalationId && (
                    <Link
                      href={`/console/${item.escalationId}`}
                      className="rounded-md border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      {item.escalationStatus === "pending" ? "Review" : "View"}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
