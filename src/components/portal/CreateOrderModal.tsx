"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { CATALOG } from "@/lib/catalog";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { formatMoney } from "@/lib/format";

export function CreateOrderModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const items = Object.entries(qty)
    .filter(([, q]) => q > 0)
    .map(([sku, quantity]) => ({ sku, quantity }));
  const total = CATALOG.reduce(
    (s, p) => s + (qty[p.sku] ?? 0) * Number(p.unitPrice),
    0,
  );

  const setItem = (sku: string, delta: number) =>
    setQty((prev) => ({
      ...prev,
      [sku]: Math.max(0, Math.min(99, (prev[sku] ?? 0) + delta)),
    }));

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("create_failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-orders"] });
      qc.invalidateQueries({ queryKey: ["portal-overview"] });
      setQty({});
      setError(null);
      onClose();
    },
    onError: () => setError("Could not create the order. Please try again."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create an order"
      description="Add items to place a new order. No payment is taken."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={items.length === 0 || create.isPending}
          >
            {create.isPending ? (
              <>
                <Spinner className="text-white" /> Creating…
              </>
            ) : (
              `Create order · ${formatMoney(total)}`
            )}
          </Button>
        </>
      }
    >
      {error && (
        <p className="mb-3 rounded-lg bg-error-50 p-3 text-sm text-error-700 ring-1 ring-inset ring-error-100">
          {error}
        </p>
      )}
      <ul className="divide-y divide-gray-100">
        {CATALOG.map((p) => {
          const n = qty[p.sku] ?? 0;
          return (
            <li key={p.sku} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{p.name}</p>
                <p className="tnum text-xs text-gray-500">{formatMoney(p.unitPrice)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setItem(p.sku, -1)}
                  disabled={n === 0}
                  aria-label={`Remove one ${p.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="tnum w-6 text-center text-sm font-semibold text-gray-900">
                  {n}
                </span>
                <button
                  type="button"
                  onClick={() => setItem(p.sku, 1)}
                  aria-label={`Add one ${p.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
