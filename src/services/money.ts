/**
 * Money helpers. Amounts are numeric(14,2) in Postgres and strings in JS; all
 * arithmetic/comparison goes through decimal.js so guardrail checks are exact
 * (never float). `toDbAmount` normalizes to a 2dp string for insertion.
 */
import Decimal from "decimal.js";

export type Money = Decimal;

export function money(value: string | number | Decimal): Decimal {
  return new Decimal(value);
}

export function sumMoney(values: Array<string | number | Decimal>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(new Decimal(v)), new Decimal(0));
}

export function toDbAmount(value: Decimal): string {
  return value.toFixed(2);
}
