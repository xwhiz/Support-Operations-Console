import { users, orders, payments } from "../../src/db/schema";
import type { makeTestDb } from "./db";

type TDB = ReturnType<typeof makeTestDb>["db"];
type OrderStatus = (typeof orders.$inferInsert)["status"];
type PaymentStatus = (typeof payments.$inferInsert)["status"];

let counter = 8000;
export function nextNumber(): number {
  return counter++;
}

export async function insertCustomer(db: TDB, email?: string) {
  const [u] = await db
    .insert(users)
    .values({
      email: email ?? `cust${nextNumber()}@test.local`,
      name: "Customer",
      passwordHash: "x",
      role: "customer",
    })
    .returning();
  return u;
}

export async function insertOrder(
  db: TDB,
  opts: {
    customerId: string;
    orderNumber?: number;
    status?: OrderStatus;
    total?: string;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
  },
) {
  const [o] = await db
    .insert(orders)
    .values({
      orderNumber: opts.orderNumber ?? nextNumber(),
      customerId: opts.customerId,
      status: opts.status ?? "paid",
      totalAmount: opts.total ?? "100.00",
      shippedAt: opts.shippedAt ?? null,
      deliveredAt: opts.deliveredAt ?? null,
    })
    .returning();
  return o;
}

export async function insertPayment(
  db: TDB,
  opts: { orderId: string; amount?: string; status?: PaymentStatus },
) {
  const [p] = await db
    .insert(payments)
    .values({
      orderId: opts.orderId,
      amount: opts.amount ?? "100.00",
      status: opts.status ?? "captured",
      providerChargeId: `ch_${nextNumber()}`,
    })
    .returning();
  return p;
}

/** Create a customer + order + one captured payment; returns all three. */
export async function seedPaidOrder(
  db: TDB,
  opts: {
    total?: string;
    status?: OrderStatus;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
  } = {},
) {
  const customer = await insertCustomer(db);
  const order = await insertOrder(db, {
    customerId: customer.id,
    total: opts.total ?? "100.00",
    status: opts.status ?? "paid",
    shippedAt: opts.shippedAt ?? null,
    deliveredAt: opts.deliveredAt ?? null,
  });
  const payment = await insertPayment(db, {
    orderId: order.id,
    amount: opts.total ?? "100.00",
  });
  return { customer, order, payment };
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
