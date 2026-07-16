/**
 * Error taxonomy for the Guarded Executor.
 *  - GuardrailError: a business rule refused the action (maps to HTTP 4xx).
 *  - ConflictError: a concurrency race / duplicate (maps to HTTP 409).
 *  - NotFoundError: target row missing (maps to HTTP 404).
 */

export type GuardrailCode =
  | "INVALID_AMOUNT"
  | "EXCEEDS_PAID"
  | "ALREADY_REFUNDED"
  | "NOTHING_REFUNDABLE"
  | "ALREADY_SHIPPED"
  | "ALREADY_CANCELLED"
  | "NOT_DELIVERED"
  | "OUTSIDE_REPLACEMENT_WINDOW"
  | "ALREADY_REPLACED"
  | "NOT_AUTHORIZED"
  | "ORDER_NOT_FOUND"
  | "PAYMENT_NOT_FOUND";

export class GuardrailError extends Error {
  readonly code: GuardrailCode;
  readonly detail?: unknown;
  constructor(code: GuardrailCode, detail?: unknown) {
    super(`guardrail: ${code}`);
    this.name = "GuardrailError";
    this.code = code;
    this.detail = detail;
  }
}

export class ConflictError extends Error {
  readonly code: string;
  readonly current?: unknown;
  constructor(code: string, current?: unknown) {
    super(`conflict: ${code}`);
    this.name = "ConflictError";
    this.code = code;
    this.current = current;
  }
}

export class NotFoundError extends Error {
  constructor(message = "not_found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** A well-formed request that cannot be processed (maps to HTTP 422). */
export class ValidationError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`validation: ${code}`);
    this.name = "ValidationError";
    this.code = code;
  }
}

/** Pull the underlying Postgres error code from a driver/Drizzle-wrapped error. */
export function pgErrorCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } } | undefined;
  return err?.cause?.code ?? err?.code;
}

export function isUniqueViolation(e: unknown): boolean {
  return pgErrorCode(e) === "23505";
}

export function isCheckViolation(e: unknown): boolean {
  return pgErrorCode(e) === "23514";
}
