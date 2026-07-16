/**
 * Shared display formatters so money and numbers read the same everywhere
 * (grouped thousands, two decimals for currency).
 */
export function formatMoney(
  value: string | number,
  currency = "USD",
): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
