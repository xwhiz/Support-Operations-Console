"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, ShoppingBag, Wallet } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingRow } from "@/components/ui/Spinner";
import { orderStatusView } from "@/components/ui/status";
import { ORDER_STATUSES, orderStatusLabel, type OrderStatus } from "@/lib/orderStatus";
import {
  Table,
  TableWrap,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui/Table";
import { OrderStatusControl } from "./OrderStatusControl";
import { formatMoney } from "@/lib/format";

type Item = { sku: string; description: string | null; quantity: number };
type Order = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  totalAmount: string;
  version: number;
  createdAt: string;
  customerName: string | null;
  customerEmail: string;
  items: Item[];
};
type Kpis = {
  total: number;
  pending: number;
  totalValue: string;
  byStatus: Record<string, number>;
};

async function fetchOrders(
  status: string,
): Promise<{ items: Order[]; kpis: Kpis }> {
  const qs = status !== "all" ? `?status=${status}` : "";
  const res = await fetch(`/api/orders${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load orders");
  return res.json();
}

export function OrdersTable() {
  const [filter, setFilter] = useState<string>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["orders", filter],
    queryFn: () => fetchOrders(filter),
  });

  const items = data?.items ?? [];
  const kpis = data?.kpis;

  const tabs = [
    { value: "all", label: "All", count: kpis?.total },
    ...ORDER_STATUSES.map((s) => ({
      value: s,
      label: orderStatusLabel(s),
      count: kpis?.byStatus[s] ?? 0,
    })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        subtitle="All customer orders and their fulfilment status."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total orders" value={kpis?.total ?? "—"} icon={ShoppingBag} />
        <StatCard label="Pending" value={kpis?.pending ?? "—"} icon={Clock} />
        <StatCard
          label="Order value"
          value={kpis ? formatMoney(kpis.totalValue) : "—"}
          icon={Wallet}
        />
        <StatCard
          label="Delivered"
          value={kpis?.byStatus["delivered"] ?? 0}
          icon={CheckCircle2}
        />
      </div>

      <div className="overflow-x-auto">
        <FilterTabs value={filter} onChange={setFilter} options={tabs} />
      </div>

      <TableWrap>
        <Table>
          <Thead>
            <Tr>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Items</Th>
              <Th>Total</Th>
              <Th>Status</Th>
              <Th>Placed</Th>
              <Th className="text-right">Action</Th>
            </Tr>
          </Thead>
          <Tbody>
            {isLoading && <LoadingRow colSpan={7} />}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon={ShoppingBag}
                    title="No orders"
                    description="No orders match this filter."
                  />
                </td>
              </tr>
            )}
            {items.map((o) => {
              const s = orderStatusView(o.status);
              const itemCount = o.items.reduce((n, i) => n + i.quantity, 0);
              return (
                <Tr key={o.id}>
                  <Td className="font-mono font-medium text-gray-900">
                    #{o.orderNumber}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={o.customerName} seed={o.customerEmail} size={32} />
                      <div className="min-w-0">
                        <div className="font-medium whitespace-nowrap text-gray-900">
                          {o.customerName ?? "Unknown"}
                        </div>
                        <div className="truncate text-xs text-gray-500">
                          {o.customerEmail}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td className="tnum text-gray-600">{itemCount}</Td>
                  <Td className="tnum font-medium text-gray-900">
                    {formatMoney(o.totalAmount)}
                  </Td>
                  <Td>
                    <Badge tone={s.tone} dot>
                      {s.label}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-gray-500">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </Td>
                  <Td>
                    <OrderStatusControl
                      orderId={o.id}
                      status={o.status}
                      version={o.version}
                    />
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
