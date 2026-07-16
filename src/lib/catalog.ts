/**
 * Fixed product catalog for the (dummy) customer order-creation flow. Prices are
 * 2dp strings so they flow straight into the money helpers, span the
 * AUTO_REFUND_MAX ($50) boundary, and are the ONLY source of truth for price —
 * the client sends sku + quantity, never a price. Single currency (USD).
 *
 * Uses no imports so it is safe to load from both server code and the seed
 * script (which runs under tsx without tsconfig path aliases).
 */
export type CatalogProduct = {
  sku: string;
  name: string;
  unitPrice: string;
  currency: string;
};

export const CATALOG: readonly CatalogProduct[] = [
  { sku: "SKU-WIDGET", name: "Blue Widget", unitPrice: "24.00", currency: "USD" },
  { sku: "SKU-GIZMO", name: "Small Gizmo", unitPrice: "18.50", currency: "USD" },
  { sku: "SKU-CABLE", name: "USB-C Cable", unitPrice: "12.00", currency: "USD" },
  { sku: "SKU-STAND", name: "Laptop Stand", unitPrice: "29.00", currency: "USD" },
  { sku: "SKU-MOUSE", name: "Wireless Mouse", unitPrice: "35.00", currency: "USD" },
  { sku: "SKU-LAMP", name: "Desk Lamp", unitPrice: "42.00", currency: "USD" },
  { sku: "SKU-HEADSET", name: "Noise-cancel Headset", unitPrice: "48.00", currency: "USD" },
  { sku: "SKU-GADGET", name: "Deluxe Gadget", unitPrice: "89.00", currency: "USD" },
  { sku: "SKU-KEYS", name: "Mechanical Keyboard", unitPrice: "95.00", currency: "USD" },
  { sku: "SKU-CHAIR", name: "Ergonomic Chair", unitPrice: "220.00", currency: "USD" },
  { sku: "SKU-MONITOR", name: '27" Monitor', unitPrice: "260.00", currency: "USD" },
  { sku: "SKU-DESK", name: "Standing Desk", unitPrice: "380.00", currency: "USD" },
];

export const CATALOG_BY_SKU: Record<string, CatalogProduct> = Object.fromEntries(
  CATALOG.map((p) => [p.sku, p]),
);

export function getProduct(sku: string): CatalogProduct | undefined {
  return CATALOG_BY_SKU[sku];
}
