"use client";

import { useQuery } from "@tanstack/react-query";
import { Banknote, Clock, ShoppingBag, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingRow } from "@/components/ui/Spinner";
import {
  Table,
  TableWrap,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui/Table";
import type { CustomersAnalytics } from "@/services/analytics";

async function fetchCustomers(): Promise<CustomersAnalytics> {
  const res = await fetch("/api/customers", { cache: "no-store" });
  if (!res.ok) throw new Error("failed to load customers");
  return res.json();
}

const usd = (v: string) =>
  `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CustomersTable() {
  const { data, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: fetchCustomers,
  });

  const rows = data?.rows ?? [];
  const k = data?.kpis;
  const maxRevenue = Math.max(1, ...rows.map((r) => Number(r.totalRevenue)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle="Revenue, orders, and support activity per customer."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total customers" value={isLoading ? "—" : k?.totalCustomers ?? 0} icon={Users} />
        <StatCard label="Total orders" value={isLoading ? "—" : k?.totalOrders ?? 0} icon={ShoppingBag} />
        <StatCard label="Total revenue" value={isLoading ? "—" : k ? usd(k.totalRevenue) : "—"} icon={Banknote} />
        <StatCard label="With open requests" value={isLoading ? "—" : k?.withOpenRequests ?? 0} icon={Clock} />
      </div>

      <TableWrap>
        <Table>
          <Thead>
            <Tr>
              <Th>Customer</Th>
              <Th>Orders</Th>
              <Th>Revenue</Th>
              <Th>Requests</Th>
              <Th>Pending</Th>
              <Th>Refunds</Th>
              <Th>Last active</Th>
            </Tr>
          </Thead>
          <Tbody>
            {isLoading && <LoadingRow colSpan={7} />}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState icon={Users} title="No customers yet" />
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <Tr key={c.customerId}>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={c.name} seed={c.email} size={36} />
                    <div className="min-w-0">
                      <div className="font-medium whitespace-nowrap text-gray-900">
                        {c.name ?? "Unknown"}
                      </div>
                      <div className="truncate text-xs text-gray-500">{c.email}</div>
                    </div>
                  </div>
                </Td>
                <Td className="tnum text-gray-700">{c.totalOrders}</Td>
                <Td className="w-48">
                  <div className="tnum font-medium text-gray-900">
                    {usd(c.totalRevenue)}
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{
                        width: `${Math.round((Number(c.totalRevenue) / maxRevenue) * 100)}%`,
                      }}
                    />
                  </div>
                </Td>
                <Td className="tnum text-gray-700">{c.supportRequestCount}</Td>
                <Td>
                  {c.pendingRequests > 0 ? (
                    <Badge tone="warning" dot>
                      {c.pendingRequests}
                    </Badge>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </Td>
                <Td className="tnum text-gray-700">{c.refundsCount}</Td>
                <Td className="whitespace-nowrap text-gray-500">
                  {c.lastActivity
                    ? new Date(c.lastActivity).toLocaleDateString()
                    : "—"}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </TableWrap>
    </div>
  );
}
