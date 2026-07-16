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
    failed: number;
    inProgress: number;
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
    reqBuckets,
    escByStatus,
    orderCount,
    revenue,
    refundsIssued,
    ttd,
    perDay,
    byActionType,
    byPolicyReason,
  ] = await Promise.all([
    // Partition EVERY request into exactly one outcome bucket so the KPI cards
    // always reconcile to the total (escalation state wins, else request state).
    dbc.execute(sql`
      select
        case
          when e.status = 'pending' then 'pending'
          when e.status in ('approved', 'executed') then 'approved'
          when e.status = 'rejected' then 'rejected'
          when e.status = 'execution_failed' then 'failed'
          when sr.status = 'auto_resolved' then 'auto_resolved'
          when sr.status = 'rejected' then 'auto_declined'
          when sr.status = 'failed' then 'failed'
          else 'in_progress'
        end as bucket,
        count(*)::int as c
      from support_requests sr
      left join escalations e on e.support_request_id = sr.id
      group by 1
    `),
    dbc.execute(sql`select status, count(*)::int as c from escalations group by status`),
    dbc.execute(sql`select count(*)::int as c from orders`),
    dbc.execute(sql`select coalesce(sum(amount), 0)::text as v from payments where status in ('captured', 'partially_refunded')`),
    dbc.execute(sql`select coalesce(sum(amount), 0)::text as v from refunds where status = 'succeeded'`),
    dbc.execute(sql`select avg(extract(epoch from (decided_at - created_at))) as sec from escalations where decided_at is not null`),
    dbc.execute(sql`select date_trunc('day', created_at) as d, count(*)::int as c from support_requests where created_at > now() - interval '30 days' group by 1 order by 1`),
    dbc.execute(sql`select action_type as name, count(*)::int as c from proposed_actions group by action_type order by c desc`),
    dbc.execute(sql`select reason as name, count(*)::int as c from proposed_actions, lateral jsonb_array_elements_text(policy_reasons) as reason group by reason order by c desc`),
  ]);

  const bucketMap: Record<string, number> = {};
  let totalRequests = 0;
  for (const r of reqBuckets.rows as Row[]) {
    bucketMap[String(r.bucket)] = n(r.c);
    totalRequests += n(r.c);
  }

  const escMap: Record<string, number> = {};
  for (const r of escByStatus.rows as Row[]) escMap[String(r.status)] = n(r.c);

  const secRow = (ttd.rows as Row[])[0];
  const avgSec = secRow?.sec != null ? Number(secRow.sec) : null;

  return {
    kpis: {
      totalRequests,
      pendingEscalations: bucketMap["pending"] ?? 0,
      approved: bucketMap["approved"] ?? 0,
      rejected: bucketMap["rejected"] ?? 0,
      autoResolved: bucketMap["auto_resolved"] ?? 0,
      autoDeclined: bucketMap["auto_declined"] ?? 0,
      failed: bucketMap["failed"] ?? 0,
      inProgress: bucketMap["in_progress"] ?? 0,
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
  refundedTotal: string;
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
    dbc.execute(sql`select o.customer_id as id, count(*)::int as c, coalesce(sum(r.amount), 0)::text as v from refunds r join orders o on o.id = r.order_id where r.status = 'succeeded' group by o.customer_id`),
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
  const refs = new Map<string, { c: number; v: string }>();
  for (const r of refRes.rows as Row[])
    refs.set(String(r.id), { c: n(r.c), v: s(r.v) });
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
      refundsCount: refs.get(id)?.c ?? 0,
      refundedTotal: refs.get(id)?.v ?? "0",
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

export type PortalOverview = {
  kpis: {
    totalOrders: number;
    totalSpend: string;
    pendingOrders: number;
    openRequests: number;
    resolvedRequests: number;
  };
  ordersByStatus: NameValue[];
  requestsByStatus: NameValue[];
  ordersPerDay: { label: string; value: number }[];
};

/** A single customer's own overview — every query scoped to their id. */
export async function getPortalOverview(
  customerId: string,
  dbc: DB = appDb,
): Promise<PortalOverview> {
  const [ordByStatus, spend, reqByStatus, perDay] = await Promise.all([
    dbc.execute(sql`select status, count(*)::int as c from orders where customer_id = ${customerId} group by status`),
    dbc.execute(sql`select coalesce(sum(p.amount), 0)::text as v from payments p join orders o on o.id = p.order_id where o.customer_id = ${customerId} and p.status in ('captured', 'partially_refunded')`),
    dbc.execute(sql`select status, count(*)::int as c from support_requests where requester_customer_id = ${customerId} group by status`),
    dbc.execute(sql`select date_trunc('day', created_at) as d, count(*)::int as c from orders where customer_id = ${customerId} and created_at > now() - interval '60 days' group by 1 order by 1`),
  ]);

  const ordMap: Record<string, number> = {};
  let totalOrders = 0;
  for (const r of ordByStatus.rows as Row[]) {
    ordMap[String(r.status)] = n(r.c);
    totalOrders += n(r.c);
  }
  const reqMap: Record<string, number> = {};
  for (const r of reqByStatus.rows as Row[]) reqMap[String(r.status)] = n(r.c);

  return {
    kpis: {
      totalOrders,
      totalSpend: s((spend.rows as Row[])[0]?.v),
      pendingOrders: (ordMap["pending"] ?? 0) + (ordMap["processing"] ?? 0),
      openRequests:
        (reqMap["received"] ?? 0) +
        (reqMap["processing"] ?? 0) +
        (reqMap["escalated"] ?? 0),
      resolvedRequests: reqMap["auto_resolved"] ?? 0,
    },
    ordersByStatus: Object.entries(ordMap).map(([name, value]) => ({
      name,
      value,
    })),
    requestsByStatus: Object.entries(reqMap).map(([name, value]) => ({
      name,
      value,
    })),
    ordersPerDay: (perDay.rows as Row[]).map((r) => ({
      label: new Date(r.d as string).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      value: n(r.c),
    })),
  };
}
