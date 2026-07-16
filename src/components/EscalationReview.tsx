"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useEscalationUpdates } from "@/hooks/useEscalationUpdates";

type Detail = {
  escalation: {
    id: string;
    status: string;
    version: number;
    decision: string | null;
    decisionNote: string | null;
    decidedByReviewerId: string | null;
    decidedByName: string | null;
    decidedAt: string | null;
    createdAt: string;
  };
  request: { message: string; customerName: string | null; createdAt: string };
  proposal: {
    actionType: string;
    description: string;
    payload: { rationale?: string; confidence?: number };
    amount: string | null;
    policyMode: string | null;
    policyReasons: string[];
    requiresHumanApproval: boolean;
  };
  order: {
    orderNumber: number;
    status: string;
    currency: string;
    total: string;
    shipped: boolean;
    delivered: boolean;
    amountPaid: string;
    amountRefunded: string;
    refundableAmount: string;
    items: { sku: string; description: string | null; quantity: number }[];
  } | null;
  trace: {
    model: string | null;
    decisionSummary: string | null;
    finalMessage: string | null;
    toolCalls: { toolName: string; input: unknown; output: unknown; isError: boolean }[];
  };
};

async function fetchDetail(id: string): Promise<Detail> {
  const res = await fetch(`/api/escalations/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load escalation");
  return res.json();
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}

export function EscalationReview({ id, viewerId }: { id: string; viewerId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["escalation", id], queryFn: () => fetchDetail(id) });
  useEscalationUpdates(() => {
    qc.invalidateQueries({ queryKey: ["escalation", id] });
    qc.invalidateQueries({ queryKey: ["queue"] });
  });

  const [confirming, setConfirming] = useState<null | "approve" | "reject">(null);
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState(false);
  const [raced, setRaced] = useState(false);

  const mutation = useMutation({
    mutationFn: async (decision: "approve" | "reject") => {
      const res = await fetch(`/api/escalations/${id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          expectedVersion: data!.escalation.version,
          note: note || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) throw new Error("conflict");
      if (!res.ok) throw new Error(body?.error ?? "decision_failed");
      return body;
    },
    onSuccess: () => {
      setConfirming(null);
      setRaced(false);
      qc.invalidateQueries({ queryKey: ["escalation", id] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e: Error) => {
      setConfirming(null);
      if (e.message === "conflict") setRaced(true); // another reviewer won the race
      qc.invalidateQueries({ queryKey: ["escalation", id] });
    },
  });

  if (isLoading) return <p className="text-sm text-neutral-400">Loading…</p>;
  if (error || !data) return <p className="text-sm text-red-600">Could not load this escalation.</p>;

  const { escalation, request, proposal, order, trace } = data;
  const isPending = escalation.status === "pending";
  const canApprove = proposal.actionType !== "escalate" && proposal.actionType !== "no_action" && !!order;
  const busy = mutation.isPending;

  const decidedLabel =
    escalation.status === "executed"
      ? "approved"
      : escalation.status === "rejected"
        ? "rejected"
        : escalation.status;
  const decidedByViewer = escalation.decidedByReviewerId === viewerId;

  return (
    <div className="space-y-4">
      <Link href="/console" className="text-sm text-neutral-500 hover:underline">
        ← Back to queue
      </Link>

      {/* Decided-state banner. The decider sees a personal confirmation; everyone
          else sees who decided it (the second reviewer sees this without clicking). */}
      {!isPending &&
        (decidedByViewer ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
            You <strong>{decidedLabel}</strong> this request.
          </div>
        ) : (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            This request was already <strong>{decidedLabel}</strong>
            {escalation.decidedByName ? ` by ${escalation.decidedByName}` : ""}.
          </div>
        ))}
      {raced && isPending && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Another reviewer just acted on this — refreshing to the latest state.
        </div>
      )}

      {/* 1. Customer request */}
      <Card title="Customer request">
        <p className="text-neutral-800 dark:text-neutral-100">“{request.message}”</p>
        <p className="mt-1 text-xs text-neutral-400">
          {request.customerName} · {new Date(request.createdAt).toLocaleString()}
        </p>
      </Card>

      {/* 2. AI recommendation */}
      <Card title="AI recommendation">
        <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{proposal.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {proposal.policyMode ?? "—"}
          </span>
          {proposal.actionType === "refund" || proposal.actionType === "cancellation" ? (
            <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
              irreversible
            </span>
          ) : null}
          {typeof proposal.payload.confidence === "number" && (
            <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
              confidence {Math.round(proposal.payload.confidence * 100)}% (advisory)
            </span>
          )}
        </div>
      </Card>

      {/* 3. Why */}
      <Card title="Why it needs review">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {proposal.policyReasons.map((r) => (
            <span key={r} className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {r}
            </span>
          ))}
        </div>
        {trace.decisionSummary && <p className="text-sm text-neutral-600 dark:text-neutral-300">{trace.decisionSummary}</p>}
      </Card>

      {/* 4. Order summary */}
      {order && (
        <Card title={`Order #${order.orderNumber}`}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div><dt className="text-neutral-400">Status</dt><dd>{order.status}</dd></div>
            <div><dt className="text-neutral-400">Total</dt><dd>${order.total}</dd></div>
            <div><dt className="text-neutral-400">Paid</dt><dd>${order.amountPaid}</dd></div>
            <div><dt className="text-neutral-400">Refundable</dt><dd>${order.refundableAmount}</dd></div>
            <div><dt className="text-neutral-400">Shipped</dt><dd>{order.shipped ? "yes" : "no"}</dd></div>
            <div><dt className="text-neutral-400">Delivered</dt><dd>{order.delivered ? "yes" : "no"}</dd></div>
            <div className="col-span-2"><dt className="text-neutral-400">Already refunded</dt><dd>${order.amountRefunded}</dd></div>
          </dl>
          <ul className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            {order.items.map((i, idx) => (
              <li key={idx}>• {i.quantity}× {i.description ?? i.sku} <span className="text-neutral-400">({i.sku})</span></li>
            ))}
          </ul>
        </Card>
      )}

      {/* 5. Agent trace (collapsible) */}
      <details className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Agent trace ({trace.toolCalls.length} tool call{trace.toolCalls.length === 1 ? "" : "s"})
        </summary>
        <ol className="mt-3 space-y-2 text-xs">
          {trace.toolCalls.map((t, idx) => (
            <li key={idx} className="rounded border border-neutral-100 p-2 dark:border-neutral-800">
              <div className="font-medium text-neutral-700 dark:text-neutral-200">{t.toolName}{t.isError ? " ⚠️" : ""}</div>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-neutral-500">in: {JSON.stringify(t.input)}</pre>
              <pre className="overflow-x-auto whitespace-pre-wrap text-neutral-500">out: {JSON.stringify(t.output)}</pre>
            </li>
          ))}
          {trace.model && <li className="text-neutral-400">model: {trace.model}</li>}
        </ol>
      </details>

      {/* 6. Decision bar */}
      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border border-neutral-200 bg-white/90 p-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        {!canApprove && isPending && (
          <span className="mr-auto text-xs text-neutral-400">No executable action — reject or handle manually.</span>
        )}
        <button
          onClick={() => setConfirming("reject")}
          disabled={!isPending || busy}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200"
        >
          Reject
        </button>
        <button
          onClick={() => { setVerified(false); setConfirming("approve"); }}
          disabled={!isPending || busy || !canApprove}
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-40"
        >
          Approve
        </button>
      </div>

      {/* Confirm modal */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setConfirming(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">
              {confirming === "approve" ? "Approve and execute" : "Reject request"}
            </h3>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              {confirming === "approve" ? (
                <>You are about to execute: <strong>{proposal.description}</strong>. This is irreversible.</>
              ) : (
                <>Reject: <strong>{proposal.description}</strong>. No action will be executed.</>
              )}
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={confirming === "reject" ? "Reason (recommended)" : "Note (optional)"}
              className="mt-3 w-full rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              rows={2}
            />
            {confirming === "approve" && (
              <label className="mt-2 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
                I verified the order, amount, and request.
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirming(null)} disabled={busy} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700">
                Cancel
              </button>
              <button
                onClick={() => mutation.mutate(confirming)}
                disabled={busy || (confirming === "approve" && !verified)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 ${confirming === "approve" ? "bg-green-700 hover:bg-green-800" : "bg-red-700 hover:bg-red-800"}`}
              >
                {busy ? "Working…" : confirming === "approve" ? "Approve & execute" : "Confirm reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
