"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Select } from "@/components/ui/Select";
import {
  ALLOWED_TRANSITIONS,
  orderStatusLabel,
  type OrderStatus,
} from "@/lib/orderStatus";

export function OrderStatusControl({
  orderId,
  status,
  version,
}: {
  orderId: string;
  status: OrderStatus;
  version: number;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const allowed = ALLOWED_TRANSITIONS[status] ?? [];

  const mut = useMutation({
    mutationFn: async (target: OrderStatus) => {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: target, expectedVersion: version }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) throw new Error("conflict");
      if (res.status === 422) throw new Error(body?.error ?? "invalid");
      if (!res.ok) throw new Error("failed");
      return body;
    },
    onSuccess: () => {
      setNote(null);
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e: Error) => {
      setNote(
        e.message === "conflict"
          ? "Changed elsewhere — refreshed."
          : e.message === "already_shipped"
            ? "Can't cancel a shipped order."
            : "Update failed.",
      );
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  if (allowed.length === 0)
    return <span className="text-xs text-gray-400">No action</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="w-40">
        <Select
          value=""
          disabled={mut.isPending}
          onChange={(e) => {
            const v = e.target.value as OrderStatus;
            if (v) mut.mutate(v);
          }}
        >
          <option value="">{mut.isPending ? "Updating…" : "Change to…"}</option>
          {allowed.map((a) => (
            <option key={a} value={a}>
              {orderStatusLabel(a)}
            </option>
          ))}
        </Select>
      </div>
      {note && <span className="text-xs text-gray-400">{note}</span>}
    </div>
  );
}
