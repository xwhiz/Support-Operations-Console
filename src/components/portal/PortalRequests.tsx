"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Send } from "lucide-react";
import { useEscalationUpdates } from "@/hooks/useEscalationUpdates";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { customerRequestStatusView } from "@/components/ui/status";

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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function PortalRequests({ prefill }: { prefill?: string }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState(prefill ?? "");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-requests"],
    queryFn: fetchMyRequests,
  });
  useEscalationUpdates(() =>
    qc.invalidateQueries({ queryKey: ["my-requests"] }),
  );

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
          throw new Error(
            "The assistant is briefly rate-limited — please try again in a moment.",
          );
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
      <PageHeader
        title="Requests"
        subtitle="Describe an issue and our assistant resolves it or routes it to a specialist."
      />

      <Card>
        <h2 className="text-base font-semibold text-gray-900">How can we help?</h2>
        <p className="mt-1 text-sm text-gray-500">
          Tell us what you need — mention the order number if it&apos;s about a
          specific order.
        </p>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (message.trim()) submit.mutate(message.trim());
          }}
        >
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="e.g. I'd like a refund for order 1001 — I changed my mind."
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={submit.isPending || !message.trim()}>
              {submit.isPending ? (
                <>
                  <Spinner className="text-white" /> Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Submit request
                </>
              )}
            </Button>
          </div>
        </form>

        {error && (
          <p className="mt-3 rounded-lg bg-error-50 p-3 text-sm text-error-700 ring-1 ring-inset ring-error-100">
            {error}
          </p>
        )}
        {result && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
            {result.finalMessage}
          </div>
        )}
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Your requests</h2>
        {isLoading ? (
          <p className="text-sm text-gray-500">
            <Spinner className="mr-2 align-[-2px] text-gray-400" />
            Loading…
          </p>
        ) : items.length === 0 ? (
          <Card>
            <p className="text-sm text-gray-500">
              You haven&apos;t submitted any requests yet.
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((r) => {
              const s = customerRequestStatusView(r);
              return (
                <Card key={r.id} className="!p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-gray-900">
                      “{r.message}”
                    </p>
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                  </div>
                  {r.finalMessage && (
                    <p className="mt-1.5 text-sm text-gray-500">
                      {r.finalMessage}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-400">
                    {timeAgo(r.createdAt)}
                  </p>
                </Card>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
