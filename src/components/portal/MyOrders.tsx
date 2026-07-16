"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Plus, ShoppingBag, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingRow } from "@/components/ui/Spinner";
import { orderStatusView } from "@/components/ui/status";
import {
  Table,
  TableWrap,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui/Table";
import { CreateOrderModal } from "./CreateOrderModal";

type OrderItem = { sku: string; description: string | null; quantity: number };
type Order = {
  id: string;
  orderNumber: number;
  status: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  items: OrderItem[];
};

async function fetchMyOrders(): Promise<Order[]> {
  const res = await fetch("/api/my-orders", { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load orders");
  return (await res.json()).items as Order[];
}

const OPEN = new Set(["pending", "paid", "processing", "shipped"]);

export function MyOrders() {
  const [open, setOpen] = useState(false);
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["my-orders"],
    queryFn: fetchMyOrders,
  });

  const totalSpent = orders
    .filter((o) => o.status !== "pending" && o.status !== "cancelled")
    .reduce((s, o) => s + Number(o.totalAmount), 0);
  const openCount = orders.filter((o) => OPEN.has(o.status)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        subtitle="Create orders and track their status."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New order
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total orders" value={orders.length} icon={ShoppingBag} />
        <StatCard
          label="Total spent"
          value={`$${totalSpent.toFixed(2)}`}
          icon={Wallet}
        />
        <StatCard label="Open orders" value={openCount} icon={Package} />
      </div>

      <TableWrap>
        <Table>
          <Thead>
            <Tr>
              <Th>Order</Th>
              <Th>Items</Th>
              <Th>Total</Th>
              <Th>Status</Th>
              <Th>Placed</Th>
            </Tr>
          </Thead>
          <Tbody>
            {isLoading && <LoadingRow colSpan={5} />}
            {!isLoading && orders.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    icon={ShoppingBag}
                    title="No orders yet"
                    description="Create your first order to get started."
                    action={
                      <Button onClick={() => setOpen(true)}>
                        <Plus className="h-4 w-4" /> New order
                      </Button>
                    }
                  />
                </td>
              </tr>
            )}
            {orders.map((o) => {
              const s = orderStatusView(o.status);
              const itemCount = o.items.reduce((n, i) => n + i.quantity, 0);
              const first = o.items[0];
              return (
                <Tr key={o.id}>
                  <Td className="font-mono font-medium text-gray-900">
                    #{o.orderNumber}
                  </Td>
                  <Td className="text-gray-600">
                    {first ? (
                      <>
                        {first.description ?? first.sku}
                        {o.items.length > 1 && (
                          <span className="text-gray-400">
                            {" "}
                            +{o.items.length - 1} more
                          </span>
                        )}
                        <span className="text-gray-400"> · {itemCount} item{itemCount === 1 ? "" : "s"}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="tnum font-medium text-gray-900">
                    ${o.totalAmount}
                  </Td>
                  <Td>
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-gray-500">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </TableWrap>

      <CreateOrderModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
