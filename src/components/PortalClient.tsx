"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useEscalationUpdates } from "@/hooks/useEscalationUpdates";

type MyRequest = {
  id: string;
  message: string;
  createdAt: string;
  status: string;
  escalationStatus: string | null;
  actionDescription: string;
  finalMessage: string | null;
};

type SubmitResult = {
  decision: "auto_resolved" | "escalated" | "rejected";
  finalMessage: string;
  action: { description: string };
};

async function fetchMyRequests(): Promise<MyRequest[]> {
  const res = await fetch("/api/my-requests", { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load requests");
  return (await res.json()).items as MyRequest[];
}

function statusView(r: MyRequest): { label: string; cls: string } {
  if (r.escalationStatus === "pending")
    return { label: "Under review", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" };
  if (r.escalationStatus === "executed")
    return { label: "Approved", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" };
  if (r.escalationStatus === "rejected")
    return { label: "Declined after review", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" };
  if (r.status === "auto_resolved")
    return { label: "Resolved", cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" };
  if (r.status === "rejected")
    return { label: "Declined", cls: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200" };
  return { label: r.status, cls: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200" };
}

export function PortalClient() {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: items = [] } = useQuery({ queryKey: ["my-requests"], queryFn: fetchMyRequests });
  useEscalationUpdates(() => qc.invalidateQueries({ queryKey: ["my-requests"] }));

  const submit = useMutation({
    mutationFn: async (text: string): Promise<SubmitResult> => {
      const res = await fetch("/api/support-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429 || body?.error === "rate_limited") {
          throw new Error("The assistant is briefly rate-limited — please try again in a moment.");
        }
        throw new Error("Something went wrong processing your request.");
      }
      return body as SubmitResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setMessage("");
      qc.invalidateQueries({ queryKey: ["my-requests"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setResult(null);
    },
  });

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">How can we help?</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Describe your issue (mention your order number). Our assistant will resolve it or pass it to a
          specialist.
        </p>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim()) submit.mutate(message.trim());
          }}
        >
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="e.g. I'd like a refund for order 1001 — I changed my mind."
            className="w-full rounded-md border border-neutral-300 p-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">Demo orders: 1001 (open), 1002 (shipped), 1003 (refunded), 1004 (delivered).</span>
            <button
              type="submit"
              disabled={submit.isPending || !message.trim()}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
            >
              {submit.isPending ? "Sending…" : "Submit request"}
            </button>
          </div>
        </form>

        {error && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        {result && (
          <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-neutral-800 dark:text-neutral-100">{result.finalMessage}</p>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">Your requests</h2>
        {items.length === 0 && <p className="text-sm text-neutral-400">No requests yet.</p>}
        <ul className="space-y-2">
          {items.map((r) => {
            const s = statusView(r);
            return (
              <li key={r.id} className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-neutral-800 dark:text-neutral-100">“{r.message}”</p>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
                </div>
                {r.finalMessage && <p className="mt-1 text-xs text-neutral-500">{r.finalMessage}</p>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
