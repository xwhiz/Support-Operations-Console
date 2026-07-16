/**
 * Read-only analytics for the reviewer console. All figures come from grouped
 * aggregate queries (no N+1). Money stays exact via string sums.
 */
import { sql } from "drizzle-orm";
import { db as appDb, type DB } from "../db/client";
import { sumMoney, toDbAmount } from "./money";

type Row = Record<string, unknown>;
const n = (v: unknown): number => Number(v ?? 0);
const s = (v: unknown): string => String(v ?? "0");

export type NameValue = { name: string; value: number };

export type AnalyticsOverview = {
  kpis: {
    totalRequests: number;
    pendingEscalations: number;
    approved: number;
    rejected: number;
    autoResolved: number;
    autoDeclined: number;
    totalOrders: number;
    totalRevenue: string;
    refundsIssued: string;
    avgTimeToDecisionHours: number | null;
  };
  requestsPerDay: { label: string; value: number }[];
  byEscalationStatus: NameValue[];
  byActionType: NameValue[];
  byPolicyReason: NameValue[];
};

export async function getAnalyticsOverview(
  dbc: DB = appDb,
): Promise<AnalyticsOverview> {
  const [
    reqByStatus,
    escByStatus,
    orderCount,
    revenue,
    refundsIssued,
    ttd,
    perDay,
    byActionType,
    byPolicyReason,
  ] = await Promise.all([
    dbc.execute(sql`select status, count(*)::int as c from support_requests group by status`),
    dbc.execute(sql`select status, count(*)::int as c from escalations group by status`),
    dbc.execute(sql`select count(*)::int as c from orders`),
    dbc.execute(sql`select coalesce(sum(amount), 0)::text as v from payments where status in ('captured', 'partially_refunded')`),
    dbc.execute(sql`select coalesce(sum(amount), 0)::text as v from refunds where status = 'succeeded'`),
    dbc.execute(sql`select avg(extract(epoch from (decided_at - created_at))) as sec from escalations where decided_at is not null`),
    dbc.execute(sql`select date_trunc('day', created_at) as d, count(*)::int as c from support_requests where created_at > now() - interval '30 days' group by 1 order by 1`),
    dbc.execute(sql`select action_type as name, count(*)::int as c from proposed_actions group by action_type order by c desc`),
    dbc.execute(sql`select reason as name, count(*)::int as c from proposed_actions, lateral jsonb_array_elements_text(policy_reasons) as reason group by reason order by c desc`),
  ]);

  const reqMap: Record<string, number> = {};
  let totalRequests = 0;
  for (const r of reqByStatus.rows as Row[]) {
    reqMap[String(r.status)] = n(r.c);
    totalRequests += n(r.c);
  }

  const escMap: Record<string, number> = {};
  for (const r of escByStatus.rows as Row[]) escMap[String(r.status)] = n(r.c);

  const secRow = (ttd.rows as Row[])[0];
  const avgSec = secRow?.sec != null ? Number(secRow.sec) : null;

  return {
    kpis: {
      totalRequests,
      pendingEscalations: escMap["pending"] ?? 0,
      approved: (escMap["approved"] ?? 0) + (escMap["executed"] ?? 0),
      rejected: escMap["rejected"] ?? 0,
      autoResolved: reqMap["auto_resolved"] ?? 0,
      autoDeclined: reqMap["rejected"] ?? 0,
      totalOrders: n((orderCount.rows as Row[])[0]?.c),
      totalRevenue: s((revenue.rows as Row[])[0]?.v),
      refundsIssued: s((refundsIssued.rows as Row[])[0]?.v),
      avgTimeToDecisionHours: avgSec != null ? Math.round((avgSec / 3600) * 10) / 10 : null,
    },
    requestsPerDay: (perDay.rows as Row[]).map((r) => ({
      label: new Date(r.d as string).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      value: n(r.c),
    })),
    byEscalationStatus: [
      { name: "Pending", value: escMap["pending"] ?? 0 },
      { name: "Approved", value: (escMap["approved"] ?? 0) + (escMap["executed"] ?? 0) },
      { name: "Rejected", value: escMap["rejected"] ?? 0 },
    ].filter((d) => d.value > 0),
    byActionType: (byActionType.rows as Row[]).map((r) => ({
      name: String(r.name),
      value: n(r.c),
    })),
    byPolicyReason: (byPolicyReason.rows as Row[]).map((r) => ({
      name: String(r.name),
      value: n(r.c),
    })),
  };
}

export type CustomerRow = {
  customerId: string;
  name: string | null;
  email: string;
  totalOrders: number;
  totalRevenue: string;
  supportRequestCount: number;
  pendingRequests: number;
  refundsCount: number;
  lastActivity: string | null;
};

export type CustomersAnalytics = {
  kpis: {
    totalCustomers: number;
    totalOrders: number;
    totalRevenue: string;
    withOpenRequests: number;
  };
  rows: CustomerRow[];
};

export async function getCustomersAnalytics(
  dbc: DB = appDb,
): Promise<CustomersAnalytics> {
  const [custRes, ordRes, revRes, reqRes, refRes, actRes] = await Promise.all([
    dbc.execute(sql`select id, name, email from users where role = 'customer' order by name`),
    dbc.execute(sql`select customer_id as id, count(*)::int as c, coalesce(sum(total_amount), 0)::text as v from orders group by customer_id`),
    dbc.execute(sql`select o.customer_id as id, coalesce(sum(p.amount), 0)::text as v from payments p join orders o on o.id = p.order_id where p.status in ('captured', 'partially_refunded') group by o.customer_id`),
    dbc.execute(sql`select requester_customer_id as id, count(*)::int as c, count(*) filter (where status in ('received', 'processing', 'escalated'))::int as pending from support_requests group by requester_customer_id`),
    dbc.execute(sql`select o.customer_id as id, count(*)::int as c from refunds r join orders o on o.id = r.order_id where r.status = 'succeeded' group by o.customer_id`),
    dbc.execute(sql`
      select id, max(ts) as last from (
        select customer_id as id, max(created_at) as ts from orders group by customer_id
        union all
        select requester_customer_id as id, max(created_at) as ts from support_requests group by requester_customer_id
      ) t group by id`),
  ]);

  const orders = new Map<string, { c: number; v: string }>();
  for (const r of ordRes.rows as Row[])
    orders.set(String(r.id), { c: n(r.c), v: s(r.v) });
  const revenue = new Map<string, string>();
  for (const r of revRes.rows as Row[]) revenue.set(String(r.id), s(r.v));
  const reqs = new Map<string, { c: number; pending: number }>();
  for (const r of reqRes.rows as Row[])
    reqs.set(String(r.id), { c: n(r.c), pending: n(r.pending) });
  const refs = new Map<string, number>();
  for (const r of refRes.rows as Row[]) refs.set(String(r.id), n(r.c));
  const last = new Map<string, string>();
  for (const r of actRes.rows as Row[])
    if (r.last) last.set(String(r.id), new Date(r.last as string).toISOString());

  const rows: CustomerRow[] = (custRes.rows as Row[]).map((c) => {
    const id = String(c.id);
    const o = orders.get(id);
    const rq = reqs.get(id);
    return {
      customerId: id,
      name: (c.name as string) ?? null,
      email: String(c.email),
      totalOrders: o?.c ?? 0,
      totalRevenue: revenue.get(id) ?? "0",
      supportRequestCount: rq?.c ?? 0,
      pendingRequests: rq?.pending ?? 0,
      refundsCount: refs.get(id) ?? 0,
      lastActivity: last.get(id) ?? null,
    };
  });

  rows.sort((a, b) => Number(b.totalRevenue) - Number(a.totalRevenue));

  return {
    kpis: {
      totalCustomers: rows.length,
      totalOrders: rows.reduce((t, r) => t + r.totalOrders, 0),
      totalRevenue: toDbAmount(sumMoney(rows.map((r) => r.totalRevenue))),
      withOpenRequests: rows.filter((r) => r.pendingRequests > 0).length,
    },
    rows,
  };
}
