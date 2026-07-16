import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, truncateAll } from "./helpers/db";
import { insertCustomer, insertOrder, insertPayment } from "./helpers/fixtures";
import {
  createOrder,
  updateOrderStatus,
  listCustomerOrders,
} from "../src/services/orders";
import { payments } from "../src/db/schema";

const { db, pool } = makeTestDb();

beforeEach(() => truncateAll(pool));
afterAll(() => pool.end());

describe("createOrder", () => {
  it("prices from the catalog, not the client, and totals correctly", async () => {
    const c = await insertCustomer(db);
    const { order, items } = await createOrder(
      { customerId: c.id, items: [{ sku: "SKU-WIDGET", quantity: 2 }] },
      db,
    );
    expect(order.status).toBe("pending");
    expect(order.version).toBe(0);
    expect(order.totalAmount).toBe("48.00"); // 24.00 x 2
    expect(items).toHaveLength(1);
    expect(items[0].unitPrice).toBe("24.00");
    expect(items[0].lineTotal).toBe("48.00");
    expect(items[0].description).toBe("Blue Widget");
  });

  it("sums multiple line items", async () => {
    const c = await insertCustomer(db);
    const { order } = await createOrder(
      {
        customerId: c.id,
        items: [
          { sku: "SKU-WIDGET", quantity: 1 }, // 24.00
          { sku: "SKU-CHAIR", quantity: 1 }, // 220.00
        ],
      },
      db,
    );
    expect(order.totalAmount).toBe("244.00");
  });

  it("rejects unknown SKUs and empty carts", async () => {
    const c = await insertCustomer(db);
    await expect(
      createOrder({ customerId: c.id, items: [{ sku: "NOPE", quantity: 1 }] }, db),
    ).rejects.toThrow("unknown_sku");
    await expect(
      createOrder({ customerId: c.id, items: [] }, db),
    ).rejects.toThrow("empty_order");
  });

  it("allocates the next order number above the current max", async () => {
    const c = await insertCustomer(db);
    await insertOrder(db, { customerId: c.id, orderNumber: 5000 });
    const { order: a } = await createOrder(
      { customerId: c.id, items: [{ sku: "SKU-CABLE", quantity: 1 }] },
      db,
    );
    const { order: b } = await createOrder(
      { customerId: c.id, items: [{ sku: "SKU-CABLE", quantity: 1 }] },
      db,
    );
    expect(a.orderNumber).toBe(5001);
    expect(b.orderNumber).toBe(5002);
  });

  it("lists a customer's own orders with items", async () => {
    const c = await insertCustomer(db);
    await createOrder(
      { customerId: c.id, items: [{ sku: "SKU-WIDGET", quantity: 1 }] },
      db,
    );
    const rows = await listCustomerOrders(c.id, db);
    expect(rows).toHaveLength(1);
    expect(rows[0].items).toHaveLength(1);
  });
});

describe("updateOrderStatus", () => {
  async function pendingOrder() {
    const c = await insertCustomer(db);
    const { order } = await createOrder(
      { customerId: c.id, items: [{ sku: "SKU-WIDGET", quantity: 1 }] },
      db,
    );
    return order;
  }

  it("advances an allowed transition and bumps the version", async () => {
    const o = await pendingOrder();
    const updated = await updateOrderStatus(
      { orderId: o.id, targetStatus: "paid", expectedVersion: 0, reviewerId: "r" },
      db,
    );
    expect(updated.status).toBe("paid");
    expect(updated.version).toBe(1);
  });

  it("rejects a disallowed transition", async () => {
    const o = await pendingOrder(); // pending -> shipped is not allowed
    await expect(
      updateOrderStatus(
        { orderId: o.id, targetStatus: "shipped", expectedVersion: 0, reviewerId: "r" },
        db,
      ),
    ).rejects.toThrow("invalid_transition");
  });

  it("blocks cancelling an order that has shipped (app-layer guard)", async () => {
    const c = await insertCustomer(db);
    // paid order that has already shipped — paid allows cancel, but the guard must refuse
    const o = await insertOrder(db, {
      customerId: c.id,
      status: "paid",
      shippedAt: new Date(),
    });
    await expect(
      updateOrderStatus(
        { orderId: o.id, targetStatus: "cancelled", expectedVersion: 0, reviewerId: "r" },
        db,
      ),
    ).rejects.toThrow("already_shipped");
  });

  it("creates exactly one captured payment when marked paid (idempotent)", async () => {
    const o = await pendingOrder();
    await updateOrderStatus(
      { orderId: o.id, targetStatus: "paid", expectedVersion: 0, reviewerId: "r" },
      db,
    );
    const rows = await db.select().from(payments).where(eq(payments.orderId, o.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("captured");
    expect(rows[0].amount).toBe(o.totalAmount);
  });

  it("does not duplicate a payment that already exists", async () => {
    const c = await insertCustomer(db);
    const o = await insertOrder(db, { customerId: c.id, status: "pending", total: "50.00" });
    await insertPayment(db, { orderId: o.id, amount: "50.00" });
    await updateOrderStatus(
      { orderId: o.id, targetStatus: "paid", expectedVersion: 0, reviewerId: "r" },
      db,
    );
    const rows = await db.select().from(payments).where(eq(payments.orderId, o.id));
    expect(rows).toHaveLength(1);
  });

  it("fails a stale-version update with a conflict", async () => {
    const o = await pendingOrder();
    await updateOrderStatus(
      { orderId: o.id, targetStatus: "paid", expectedVersion: 0, reviewerId: "r" },
      db,
    );
    await expect(
      updateOrderStatus(
        { orderId: o.id, targetStatus: "processing", expectedVersion: 0, reviewerId: "r" },
        db,
      ),
    ).rejects.toThrow("order_state_changed");
  });
});
