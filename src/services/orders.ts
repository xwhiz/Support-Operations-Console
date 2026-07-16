/**
 * Order read/write service.
 *
 * Customers create dummy orders (no checkout) from a fixed CATALOG; reviewers
 * advance an order's status. All writes are transactional and go through the
 * same discipline as the guarded executor: SELECT ... FOR UPDATE + version CAS,
 * so a manual status change racing a refund/cancellation correctly conflicts.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db as appDb, type DB } from "../db/client";
import { orders, orderItems, payments, users } from "../db/schema";
import { money, sumMoney, toDbAmount } from "./money";
import { getProduct } from "../lib/catalog";
import { ALLOWED_TRANSITIONS, type OrderStatus } from "../lib/orderStatus";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  isUniqueViolation,
} from "./errors";

export type { OrderStatus };

export type OrderItemRow = typeof orderItems.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;

export type CustomerOrder = OrderRow & { items: OrderItemRow[] };
export type AdminOrder = CustomerOrder & {
  customerName: string | null;
  customerEmail: string;
};

export type OrderKpis = {
  total: number;
  pending: number;
  totalValue: string;
  byStatus: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function itemsByOrder(
  orderIds: string[],
  dbc: DB,
): Promise<Map<string, OrderItemRow[]>> {
  const map = new Map<string, OrderItemRow[]>();
  if (orderIds.length === 0) return map;
  const rows = await dbc
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds));
  for (const r of rows) {
    const list = map.get(r.orderId) ?? [];
    list.push(r);
    map.set(r.orderId, list);
  }
  return map;
}

/**
 * Next order number. An advisory lock serializes concurrent allocation so the
 * `orders.orderNumber` unique index is never hit. Empty DB -> 1001.
 */
async function nextOrderNumber(tx: DB): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(4815162342)`);
  const res = await tx.execute(
    sql`SELECT COALESCE(MAX(order_number), 1000) + 1 AS n FROM orders`,
  );
  return Number((res.rows[0] as { n: string | number }).n);
}

// ---------------------------------------------------------------------------
// Create (customer)
// ---------------------------------------------------------------------------

export async function createOrder(
  input: { customerId: string; items: { sku: string; quantity: number }[] },
  dbc: DB = appDb,
): Promise<{ order: OrderRow; items: OrderItemRow[] }> {
  if (!input.items || input.items.length === 0)
    throw new ValidationError("empty_order");

  let currency: string | null = null;
  const lines = input.items.map((it) => {
    const product = getProduct(it.sku);
    if (!product) throw new ValidationError("unknown_sku");
    if (!Number.isInteger(it.quantity) || it.quantity < 1)
      throw new ValidationError("invalid_quantity");
    if (currency && currency !== product.currency)
      throw new ValidationError("mixed_currency");
    currency = product.currency;
    return {
      sku: product.sku,
      description: product.name,
      quantity: it.quantity,
      unitPrice: product.unitPrice,
      lineTotal: toDbAmount(money(product.unitPrice).times(it.quantity)),
    };
  });

  const total = toDbAmount(sumMoney(lines.map((l) => l.lineTotal)));
  if (money(total).lte(0)) throw new ValidationError("zero_total");

  return dbc.transaction(async (tx) => {
    const orderNumber = await nextOrderNumber(tx as unknown as DB);
    const [order] = await tx
      .insert(orders)
      .values({
        orderNumber,
        customerId: input.customerId,
        status: "pending",
        currency: currency ?? "USD",
        totalAmount: total,
      })
      .returning();
    const items = await tx
      .insert(orderItems)
      .values(lines.map((l) => ({ orderId: order.id, ...l })))
      .returning();
    return { order, items };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listCustomerOrders(
  customerId: string,
  dbc: DB = appDb,
): Promise<CustomerOrder[]> {
  const rows = await dbc
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.createdAt));
  const items = await itemsByOrder(
    rows.map((r) => r.id),
    dbc,
  );
  return rows.map((o) => ({ ...o, items: items.get(o.id) ?? [] }));
}

export async function listAllOrders(
  opts: { status?: OrderStatus } = {},
  dbc: DB = appDb,
): Promise<{ items: AdminOrder[]; kpis: OrderKpis }> {
  const base = dbc
    .select({
      order: orders,
      customerName: users.name,
      customerEmail: users.email,
    })
    .from(orders)
    .innerJoin(users, eq(orders.customerId, users.id))
    .orderBy(desc(orders.createdAt));

  const rows = opts.status
    ? await base.where(eq(orders.status, opts.status))
    : await base;

  const itemMap = await itemsByOrder(
    rows.map((r) => r.order.id),
    dbc,
  );

  const items: AdminOrder[] = rows.map((r) => ({
    ...r.order,
    items: itemMap.get(r.order.id) ?? [],
    customerName: r.customerName,
    customerEmail: r.customerEmail,
  }));

  // KPIs over ALL orders (not the filtered slice), in one grouped query.
  const grouped = await dbc
    .select({
      status: orders.status,
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${orders.totalAmount}), 0)`,
    })
    .from(orders)
    .groupBy(orders.status);

  const byStatus: Record<string, number> = {};
  let total = 0;
  const valueParts: string[] = [];
  for (const g of grouped) {
    byStatus[g.status] = g.count;
    total += g.count;
    if (g.status !== "cancelled") valueParts.push(g.value);
  }

  return {
    items,
    kpis: {
      total,
      pending: byStatus["pending"] ?? 0,
      totalValue: toDbAmount(sumMoney(valueParts)),
      byStatus,
    },
  };
}

// ---------------------------------------------------------------------------
// Status change (reviewer)
// ---------------------------------------------------------------------------

export async function updateOrderStatus(
  cmd: {
    orderId: string;
    targetStatus: OrderStatus;
    expectedVersion: number;
    reviewerId: string;
  },
  dbc: DB = appDb,
): Promise<OrderRow> {
  return dbc.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, cmd.orderId))
      .for("update");
    if (!order) throw new NotFoundError("order_not_found");

    const allowed = ALLOWED_TRANSITIONS[order.status as OrderStatus] ?? [];
    if (!allowed.includes(cmd.targetStatus))
      throw new ValidationError("invalid_transition");

    // The DB trigger only blocks cancellations on the cancellations table, not a
    // direct orders update — so enforce "no cancel once shipped" here.
    if (
      cmd.targetStatus === "cancelled" &&
      (order.shippedAt !== null || order.deliveredAt !== null)
    ) {
      throw new ValidationError("already_shipped");
    }

    const now = new Date();
    const set: Partial<typeof orders.$inferInsert> = {
      status: cmd.targetStatus,
      version: cmd.expectedVersion + 1,
      updatedAt: now,
    };
    if (cmd.targetStatus === "shipped" && !order.shippedAt) set.shippedAt = now;
    if (cmd.targetStatus === "delivered") {
      set.deliveredAt = now;
      if (!order.shippedAt) set.shippedAt = now; // delivery implies shipment
    }
    if (cmd.targetStatus === "cancelled") set.cancelledAt = now;

    // Becoming paid wires the order into the refund/cancel triage: the executor
    // requires a captured payment. Insert one, idempotently.
    if (cmd.targetStatus === "paid") {
      const [existing] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(eq(payments.orderId, order.id), eq(payments.status, "captured")),
        )
        .limit(1);
      if (!existing) {
        try {
          await tx.insert(payments).values({
            orderId: order.id,
            provider: "mock",
            providerChargeId: `mock_paid_${order.id}`,
            amount: order.totalAmount,
            currency: order.currency,
            status: "captured",
            capturedAt: now,
          });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e; // already paid -> idempotent
        }
      }
    }

    const [updated] = await tx
      .update(orders)
      .set(set)
      .where(
        and(eq(orders.id, cmd.orderId), eq(orders.version, cmd.expectedVersion)),
      )
      .returning();
    if (!updated)
      throw new ConflictError("order_state_changed", {
        id: order.id,
        status: order.status,
        version: order.version,
      });
    return updated;
  });
}
