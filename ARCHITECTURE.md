# Architecture — Support Operations Console

An AI agent triages e-commerce support requests (refunds, cancellations, replacements); a human-reviewer console approves or rejects the risky ones. The store's rule drives every decision:

> **An incorrect refund/cancellation is far worse than escalating too often.** So the system defaults toward the human, and safety lives in code + the database — never in the prompt.

**Stack:** Next.js 16 (App Router, Node runtime) for UI + API · PostgreSQL 16 · Drizzle ORM over `pg` · Google Gemini via `@google/genai` (manual tool-calling loop) · `decimal.js` money · `jose`+`bcryptjs` sessions · TanStack Query + Postgres LISTEN/NOTIFY long-poll. Deployed on Railway (persistent container).

---

## The one load-bearing idea

**Every state-changing operation passes through one Guarded Executor, inside one Postgres transaction.** The agent only *reads* and *proposes*; a deterministic Policy Engine (not the model) decides `AUTO | ESCALATE | REJECT`; and the executor re-checks every guardrail + concurrency invariant regardless of what the model or a human said.

```
        Customer request
               │
               ▼
        LLM Agent (Gemini)   read: getOrder / getCustomerOrders
               │             propose: proposeRefund / proposeCancellation / proposeReplacement / escalate
               ▼
        Proposed action (intent only — no mutation)
               │
               ▼
        Policy Engine  ──►  { AUTO | ESCALATE | REJECT, reasons[] }   (deterministic; policy.ts)
        ┌──────────────┼───────────────┐
        ▼              ▼                ▼
      AUTO          ESCALATE          REJECT
        │           reviewer          auto-decline
        │           approves          + explanation
        └──────┬───────┘
               ▼
        GUARDED EXECUTOR  (one txn — guarded-executor.ts)
        SELECT … FOR UPDATE · guardrails under lock · partial-unique-index INSERT
        · version CAS · idempotency key
               ▼
        PostgreSQL  (refunds / cancellations / replacements + full trace)
```

## Agent boundary — a system property, not a prompt

- **The agent's tools never mutate business state.** Read tools return data scoped to the authenticated customer; "propose" tools only insert a `proposed_actions` row and return an ack (`src/agent/tools.ts`). There is *no* tool that issues a refund.
- **The Policy Engine decides the execution mode** (`src/services/policy.ts`, pure/deterministic): `AUTO` only when the requester owns the order and it's within limits (refund ≤ paid **and** ≤ `AUTO_REFUND_MAX`; cancel only if unshipped and within the window); `REJECT` for hard-invalid-but-safe-to-decline cases (already shipped, nothing refundable); `ESCALATE` for everything else (above limit, exceeds paid, replacement, not-authorized, ambiguous). Replacements are **always** escalated.
- **Only `guarded-executor.ts` writes** to `refunds`/`cancellations`/`replacements`. Both the auto path (intake) and the human path (approval) call the same functions. A prompt-injected or hallucinating model cannot cause an unsafe mutation, because it has no path to one.

## Tool design

Two read tools + four propose tools, declared as plain JSON Schema (`TOOL_DEFS`). Read tools (`getOrder`, `getCustomerOrders`) query the DB **scoped by `session.sub`**, so the model literally cannot see another customer's orders. Propose tools record intent and return "recorded for review; nothing has happened yet." Data returned to the model is minimal and derived (status, amounts, refundable amount) — never internal ids. The loop (`src/agent/loop.ts`) is a manual `generateContent` loop that persists the full trace and stops as soon as a proposal is recorded (one fewer model round-trip); it echoes Gemini's `thoughtSignature` back so tool-calling works on both 2.x and 3.x models.

## Guardrails (enforced in application code + a DB backstop)

`src/services/guarded-executor.ts` — checks run **after** `SELECT … FOR UPDATE`, so they read the state the winner will mutate:

| Rule | App check (guarded-executor.ts) | DB backstop |
|---|---|---|
| Refund ≤ amount paid | `amount.gt(paid − refunded) → EXCEEDS_PAID` (Decimal) | `refunds_amount_positive` CHECK |
| No double refund | `activeRefundCount > 0 → NOTHING_REFUNDABLE`; INSERT conflict | `uniq_active_refund_per_order` **partial unique index** |
| No cancel once fulfilled | `order.shippedAt != null \|\| order.deliveredAt != null → ALREADY_SHIPPED` (delivery implies shipment) | `trg_cancellation_not_shipped` **trigger** (shipped OR delivered) |

Every attempt (success, guardrail rejection, conflict) is written to `execution_attempts` — so a *refused* action is itself auditable. Because each rule has both an app check and an independent DB constraint, the executor rejects unsafe actions **even if the Policy Engine or a human approves them**.

## Concurrency (at the database level, not timing)

Isolation is READ COMMITTED; correctness comes from explicit locks + constraints, so no retry loop is needed.

- **Double refund** (`executeRefund`): lock the order `FOR UPDATE` (the 2nd request blocks); read paid/refunded under the lock; `INSERT` the refund, which claims the `uniq_active_refund_per_order` slot; conditionally `UPDATE orders … WHERE version = ?`. The loser either finds nothing refundable or hits the unique index → `ConflictError` (409). *Exactly one active refund row per order, always* — even if the app check were removed, the index enforces it.
- **Double approval** (`src/services/escalations.ts`): approval **and** execution are one transaction — lock the escalation `FOR UPDATE`, require `status='pending'` **and** `version = expectedVersion`, run the same guarded executor, then `UPDATE … WHERE status='pending' AND version=?`. Three independent guards; the loser gets a 409 carrying the current state so the UI shows who decided. *Verified live: two concurrent approvals → one `200`, one `409`, exactly one refund.*
- The payment "provider" call is a mock done **outside** the transaction, keyed by an idempotency key, so a lock is never held across an external call.

## Failure handling

- **Hallucinated order id** → `getOrder` returns "not found / not accessible"; if the agent proposes anyway, the order can't be resolved → Policy `ORDER_NOT_FOUND` → **REJECT (auto-decline)**; the executor also throws `ORDER_NOT_FOUND`.
- **Refund > payment** → caught three times: Policy `EXCEEDS_PAID` (escalate, so a human can choose a valid amount), the guardrail under the lock, and the `amount > 0` CHECK.
- **Someone else's order** → the authorization anchor is `session.sub`, never the message or model: read tools filter by it, and Policy `NOT_AUTHORIZED` → **REJECT (auto-decline)** — a cross-tenant reference is declined, never turned into a human-approvable action on another customer's order. The executor also re-verifies ownership on the auto path.
- **LLM refusal / rate limit / max iterations** → the run records `stop_reason`; a run with no valid proposal defaults to an escalation (fail toward the human).

## Traceability

From one `support_requests` row you can reconstruct everything: `agent_runs` (model, decision, `decision_summary`, customer message) → `agent_messages` + `tool_calls` (every tool input/output) → `proposed_actions` (intent + policy mode + reasons) → `escalations` (reviewer decision) → `refunds`/`cancellations`/`replacements` + `execution_attempts` (including rejected attempts). We store a concise `decision_summary`, **not** raw chain-of-thought. `confidence` (if the model provides it) is stored and displayed as **advisory only** — never an input to a safety decision.

## Build vs Buy (honest)

| Concern | Built here | Would adopt at scale |
|---|---|---|
| Durable async execution | Synchronous execute-after-CAS + idempotency keys (the *pattern*) | pg-boss → BullMQ/Redis → **Temporal** for durable human-in-the-loop workflows |
| Agent framework | Raw `@google/genai` manual loop (transparent; keeps the boundary obvious) | **LangGraph**/Mastra once orchestration/state gets complex |
| Agent observability | Own `agent_runs`/`tool_calls` tables → power the trace UI directly | **Langfuse** + OpenTelemetry for traces/evals/cost |
| Live updates | Long-poll via Postgres LISTEN/NOTIFY | SSE (adopt when review volume justifies a worker) |
| Auth | `jose`+`bcryptjs` session + code-map RBAC | Auth.js / an IdP; DB-backed roles/permissions |
| Payments | Mock provider | Stripe (refunds are already idempotency-keyed) |

The philosophy: **build the pattern, not the heavy infra.** The patterns (guarded executor, idempotency, own trace tables, CAS) are what demonstrate the design; the infra is a swap-in.

## Design decisions (with rejected alternatives)

1. **Tools propose; a guarded executor executes.** *Rejected:* letting the agent's tools perform refunds directly — it puts an irreversible side effect inside the model's control loop, so one reasoning error or injection fires a bad refund, and the approval boundary becomes a sentence in a prompt instead of a code path.
2. **Optimistic version CAS + row lock + partial unique index + idempotency.** *Rejected:* last-write-wins (fails the requirement); a Redis/advisory distributed lock (extra infra, and a lock alone still needs idempotency to prevent double-execution across retries, so it earns nothing here).
3. **Long-poll via LISTEN/NOTIFY, not websockets.** *Rejected:* websockets (stateful, overkill for a human-review cadence); naive interval polling (redundant load). Correctness is in the CAS, so live updates are purely a latency optimization — downgrading to polling costs seconds of staleness, not correctness.
4. **Drizzle over Prisma; `decimal.js`+`numeric` over floats; lean `jose`/`bcryptjs` session over Auth.js** — the concurrency core is `SELECT … FOR UPDATE` + conditional-`UPDATE`-`RETURNING`, which Drizzle expresses as first-class, legible queries; money must be exact; and a transparent session keeps the authorization story easy to defend without framework magic the assessment doesn't grade.
