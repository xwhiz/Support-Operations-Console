"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useEscalationUpdates } from "@/hooks/useEscalationUpdates";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { formatMoney } from "@/lib/format";

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
    toolCalls: {
      toolName: string;
      input: unknown;
      output: unknown;
      isError: boolean;
    }[];
  };
};

async function fetchDetail(id: string): Promise<Detail> {
  const res = await fetch(`/api/escalations/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load escalation");
  return res.json();
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="tnum mt-0.5 text-sm font-medium text-gray-900">{value}</dd>
    </div>
  );
}

export function EscalationReview({
  id,
  viewerId,
}: {
  id: string;
  viewerId: string;
}) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["escalation", id],
    queryFn: () => fetchDetail(id),
  });
  useEscalationUpdates(() => {
    qc.invalidateQueries({ queryKey: ["escalation", id] });
    qc.invalidateQueries({ queryKey: ["queue"] });
  });

  const [confirming, setConfirming] = useState<null | "approve" | "reject">(
    null,
  );
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState(false);
  const [raced, setRaced] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
      setErrorMsg(null);
      qc.invalidateQueries({ queryKey: ["escalation", id] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e: Error) => {
      setConfirming(null);
      if (e.message === "conflict") {
        setRaced(true);
      } else {
        setErrorMsg(
          "Something went wrong completing this action. Please try again.",
        );
      }
      qc.invalidateQueries({ queryKey: ["escalation", id] });
    },
  });

  if (isLoading)
    return (
      <p className="text-sm text-gray-500">
        <Spinner className="mr-2 align-[-2px] text-gray-400" />
        Loading escalation…
      </p>
    );
  if (error || !data)
    return (
      <p className="text-sm text-error-600">Could not load this escalation.</p>
    );

  const { escalation, request, proposal, order, trace } = data;
  const isPending = escalation.status === "pending";
  const canApprove =
    proposal.actionType !== "escalate" &&
    proposal.actionType !== "no_action" &&
    !!order;
  const busy = mutation.isPending;
  const irreversible =
    proposal.actionType === "refund" || proposal.actionType === "cancellation";

  const decidedLabel =
    escalation.status === "executed"
      ? "approved"
      : escalation.status === "rejected"
        ? "rejected"
        : escalation.status;
  const decidedByViewer = escalation.decidedByReviewerId === viewerId;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-6">
      <Link
        href="/console/requests"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" /> Back to requests
      </Link>

      {!isPending &&
        (decidedByViewer ? (
          <div className="rounded-lg border border-success-100 bg-success-50 p-3.5 text-sm text-success-700">
            You <strong>{decidedLabel}</strong> this request.
          </div>
        ) : (
          <div className="rounded-lg border border-warning-100 bg-warning-50 p-3.5 text-sm text-warning-700">
            This request was already <strong>{decidedLabel}</strong>
            {escalation.decidedByName ? ` by ${escalation.decidedByName}` : ""}.
          </div>
        ))}
      {raced && isPending && (
        <div className="rounded-lg border border-warning-100 bg-warning-50 p-3.5 text-sm text-warning-700">
          Another reviewer just acted on this — refreshing to the latest state.
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-error-100 bg-error-50 p-3.5 text-sm text-error-700">
          {errorMsg}
        </div>
      )}

      <SectionCard title="Customer request">
        <p className="text-gray-900">“{request.message}”</p>
        <p className="mt-2 text-xs text-gray-400">
          {request.customerName} ·{" "}
          {new Date(request.createdAt).toLocaleString()}
        </p>
      </SectionCard>

      <SectionCard title="AI recommendation">
        <p className="text-lg font-semibold text-gray-900">
          {proposal.description}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="gray">{proposal.policyMode ?? "—"}</Badge>
          {irreversible && <Badge tone="error">Irreversible</Badge>}
          {typeof proposal.payload.confidence === "number" && (
            <Badge tone="gray">
              Confidence {Math.round(proposal.payload.confidence * 100)}%
              (advisory)
            </Badge>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Why it needs review">
        {proposal.policyReasons.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {proposal.policyReasons.map((r) => (
              <Badge key={r} tone="warning">
                {r}
              </Badge>
            ))}
          </div>
        )}
        {trace.decisionSummary && (
          <p className="text-sm text-gray-600">{trace.decisionSummary}</p>
        )}
      </SectionCard>

      {order && (
        <SectionCard title={`Order #${order.orderNumber}`}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Metric label="Status" value={order.status} />
            <Metric label="Total" value={formatMoney(order.total)} />
            <Metric label="Paid" value={formatMoney(order.amountPaid)} />
            <Metric label="Refundable" value={formatMoney(order.refundableAmount)} />
            <Metric label="Shipped" value={order.shipped ? "Yes" : "No"} />
            <Metric label="Delivered" value={order.delivered ? "Yes" : "No"} />
            <Metric
              label="Already refunded"
              value={formatMoney(order.amountRefunded)}
            />
          </dl>
          <ul className="mt-4 space-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600">
            {order.items.map((i, idx) => (
              <li key={idx}>
                {i.quantity}× {i.description ?? i.sku}{" "}
                <span className="text-gray-400">({i.sku})</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <details className="group rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Agent trace ({trace.toolCalls.length} tool call
          {trace.toolCalls.length === 1 ? "" : "s"})
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <ol className="mt-4 space-y-2 font-mono text-xs">
          {trace.toolCalls.map((t, idx) => (
            <li key={idx} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="font-sans font-medium text-gray-700">
                {t.toolName}
                {t.isError ? " ⚠️" : ""}
              </div>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-gray-500">
                in: {JSON.stringify(t.input)}
              </pre>
              <pre className="overflow-x-auto whitespace-pre-wrap text-gray-500">
                out: {JSON.stringify(t.output)}
              </pre>
            </li>
          ))}
          {trace.model && (
            <li className="font-sans text-gray-400">model: {trace.model}</li>
          )}
        </ol>
      </details>

      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-xl border border-gray-200 bg-white/90 p-3 shadow-md backdrop-blur">
        {!canApprove && isPending && (
          <span className="mr-auto text-xs text-gray-400">
            No executable action — reject or handle manually.
          </span>
        )}
        <Button
          variant="secondary"
          onClick={() => setConfirming("reject")}
          disabled={!isPending || busy}
        >
          Reject
        </Button>
        <Button
          variant="success"
          onClick={() => {
            setVerified(false);
            setConfirming("approve");
          }}
          disabled={!isPending || busy || !canApprove}
        >
          Approve
        </Button>
      </div>

      <Modal
        open={confirming !== null}
        onClose={() => !busy && setConfirming(null)}
        title={
          confirming === "approve" ? "Approve and execute" : "Reject request"
        }
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirming(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant={confirming === "approve" ? "success" : "danger"}
              onClick={() => confirming && mutation.mutate(confirming)}
              disabled={busy || (confirming === "approve" && !verified)}
            >
              {busy
                ? "Working…"
                : confirming === "approve"
                  ? "Approve & execute"
                  : "Confirm reject"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {confirming === "approve" ? (
            <>
              You are about to execute: <strong>{proposal.description}</strong>.
              This is irreversible.
            </>
          ) : (
            <>
              Reject: <strong>{proposal.description}</strong>. No action will be
              executed.
            </>
          )}
        </p>
        <div className="mt-4">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              confirming === "reject" ? "Reason (recommended)" : "Note (optional)"
            }
            rows={2}
          />
        </div>
        {confirming === "approve" && (
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-brand-500"
            />
            I verified the order, amount, and request.
          </label>
        )}
      </Modal>
    </div>
  );
}
