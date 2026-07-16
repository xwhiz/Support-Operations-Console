# Support Operations Console — Implementation Plan (Vertical-Sliced)

## Context

8-hour, 3-day full-stack assessment (`C:\Users\muham\Desktop\assessment`, greenfield). We build a **Support Operations Console** for an e-commerce store: an AI agent triages customer support requests (refunds, cancellations), and a human-reviewer dashboard approves/rejects the risky ones.

The store's one strict rule drives every decision:

> **An incorrect refund or cancellation is significantly worse than escalating too many requests.**

The human reviewer is the center of the product. The system is graded on three things being **genuine system properties, not prompt text**: (1) **guardrails** in application code, (2) **concurrency safety** at the DB level, (3) **traceability** from the DB alone.

**Confirmed with the user:** LLM = **Google Gemini** (free tier, `@google/genai`); Deploy = **Railway**; Scope = **Refund + Cancel + Replacement** (replacement is **escalate-only** — always human-reviewed); Identity = **simple session auth**; Agent = **single-pass decision + natural-language explanation** (ambiguity → escalate, no chat); Styling = **Tailwind only** (no shadcn).

**Delivery method (user-directed):** build **one vertical at a time, in order**. For each vertical I (a) implement it, (b) write **automated tests**, then (c) hand off for the user to verify. User approves or requests changes before the next vertical.

---

## The load-bearing principle (one sentence)

**Every state-changing operation passes through the Guarded Executor.** The agent's tools only READ and PROPOSE — no tool mutates money or order state. A deterministic **Policy Engine** (not the model) decides `AUTO` / `ESCALATE` / `REJECT`. A single **Guarded Executor** (inside one Postgres transaction) is the only code path that executes a refund/cancellation, re-checking every guardrail + concurrency constraint regardless of what the LLM said.

**Separation of duties:** the **agent decides intent** (`refund` | `cancellation` | `escalate`); the **Policy Engine decides execution mode** (`AUTO` | `ESCALATE` | `REJECT`). That split is what makes the approval boundary a real system property.

---

## Tech Stack (final)

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router, Node runtime)** — UI + API in one service; **SSR/RSC gated by permission**, client components only for the "moving parts" (live queue, approve/reject, conflict banner) | Single deploy; route handlers give real HTTP status codes (the `409` UX needs this); Node runtime (not Edge) for `pg` + LISTEN/NOTIFY. |
| Language | **TypeScript** end-to-end | Required. |
| Styling | **Tailwind CSS only** (utility-first, no bespoke CSS, no shadcn); the 2 primitives we need (confirm modal, dropdown) are hand-rolled | Fast, nothing extra to theme/manage; clarity over polish per the brief. |
| DB | **PostgreSQL 16** (local: docker; prod: Railway) | Required. |
| DB access | **Drizzle ORM** over **`pg` Pool**; **`pgEnum`** for all status columns | Concurrency core = `SELECT … FOR UPDATE` + partial unique index + `UPDATE … WHERE version=? RETURNING` — first-class in Drizzle. Single in-process pool on Railway's persistent container. |
| Money | **`numeric(14,2)`** columns + **`decimal.js`** in TS, one `Money` type | Exact precision, no floats (JS has no native BigDecimal). All guardrail math uses `Decimal` comparisons. |
| LLM | **Gemini** via **`@google/genai`**, `gemini-2.5-flash` (env-configurable), **manual** function-calling loop; isolated behind `src/agent/llm.ts` | Free tier; manual loop persists trace + enforces propose/execute boundary. Model choice is safety-irrelevant (safety is in code). One-file swap to Claude/OpenAI. |
| Validation | **zod** | HTTP bodies + LLM tool inputs + env. |
| Auth | **Simple session**: `bcryptjs` logins for seeded users + one signed **`jose`** JWT session cookie (~24h, httpOnly); **role carried in the token**; **`src/lib/rbac.ts` code-map** maps route→required permission, checked in `middleware.ts` | Enough to power the two graded scenarios (authorization guardrail + reviewer identity) without token/RBAC machinery reviewers don't grade. |
| Live updates | **Long polling** via Postgres **LISTEN/NOTIFY** (`src/lib/notify.ts` + `AFTER INSERT/UPDATE` trigger → `pg_notify`) | Server holds request ~25s, returns on NOTIFY (or timeout), client reconnects → no flood of redundant requests. Viable because Railway is persistent. |
| Config | **`src/config.ts`** — the ONLY module reading `process.env` (zod-validated, typed); `.env` + `.env.example` + `.gitignore` | Single source of env truth. |
| Tests | **Vitest** (unit + integration against a real `*_test` Postgres from docker compose); concurrency tests use real pg; a Node script fires concurrent requests | Concurrency correctness must be tested on real Postgres. |
| Local dev | **`docker-compose.yml`: Postgres + Adminer** | User explores the DB in Adminer. |
| Deploy | **Railway**: Next.js container + Railway Postgres + public HTTPS URL | Persistent container → agent loop + LISTEN/NOTIFY + single pool all work. |

---

## Data Model (Postgres, Drizzle, `pgEnum`, `numeric` money)

`pgcrypto` (`gen_random_uuid()`), `citext` (emails). Enums: `role`, `order_status`, `payment_status`, `refund_status`, `cancellation_status`, `replacement_status`, `request_status`, `run_status`, `escalation_status`, `decision`, `policy_mode`, `execution_outcome`, `initiated_via`, `action_type`.

**Identity (simple)**
- `users(id, email citext UNIQUE, name, password_hash, role role /* customer|reviewer|admin */, created_at)` — seeded. No RBAC join tables, no refresh tokens. Permissions live in `src/lib/rbac.ts` as a role→permissions map.

**Business / reference**
- `orders(id, order_number bigint UNIQUE, customer_id fk→users, status order_status, currency char(3), total_amount numeric(14,2), shipped_at, delivered_at, cancelled_at, version int default 0, created_at, updated_at)`
- `order_items(id, order_id fk, sku, description, quantity int>0, unit_price numeric(14,2), line_total numeric(14,2))`
- `payments(id, order_id fk, provider, provider_charge_id UNIQUE, amount numeric(14,2)>0, currency, status payment_status, captured_at)`

**Action tables (concurrency-critical)**
- `refunds(id, order_id fk, payment_id fk, amount numeric(14,2)>0, currency, status refund_status default 'pending', reason, idempotency_key text UNIQUE, external_refund_id UNIQUE, created_by text, agent_run_id fk?, escalation_id fk?, created_at)`
  - **`CREATE UNIQUE INDEX uniq_active_refund_per_order ON refunds(order_id) WHERE status IN ('pending','succeeded');`** ← DB-level double-refund guarantee.
- `cancellations(id, order_id fk, status cancellation_status default 'pending', reason, idempotency_key UNIQUE, created_by, agent_run_id fk?, escalation_id fk?, created_at)`
  - `uniq_active_cancellation_per_order` partial unique index.
  - **`BEFORE INSERT` trigger `assert_order_not_shipped()`** → raises if `orders.shipped_at IS NOT NULL`.
- `replacements(id, order_id fk, item_sku text?, status replacement_status default 'pending', reason, idempotency_key UNIQUE, created_by, agent_run_id fk?, escalation_id fk?, created_at)`
  - `uniq_active_replacement_per_order` partial unique index (one active replacement per order). Executed **only via human approval** (replacement is always escalate-only). *(Shipment tracking + inventory checks are a documented scale extension, not built.)*

**Request + trace + escalation (traceability)**
- `support_requests(id, requester_customer_id fk→users, raw_text, channel, referenced_order_number bigint?, status request_status, created_at, updated_at)`
- `agent_runs(id, support_request_id fk, model, status run_status, stop_reason, iterations, input_tokens, output_tokens, final_decision, decision_summary text /* concise structured "why" — NO chain-of-thought */, final_message text /* customer-facing explanation */, error, started_at, ended_at)`
- `agent_messages(id, agent_run_id fk, seq, role, content jsonb, created_at, UNIQUE(run,seq))` — raw provider blocks (tool_use/tool_result/text), replayable. **Thinking/CoT is not requested from the model and not stored.**
- `tool_calls(id, agent_run_id fk, seq, tool_name, tool_use_id, input jsonb, output jsonb, is_error, started_at, ended_at, UNIQUE(run,tool_use_id))`
- `proposed_actions(id, agent_run_id fk, support_request_id fk, action_type, target_order_id fk?, payload jsonb /* {type, orderNumber, amount, currency, rationale, humanSummary, confidence} */, policy_mode policy_mode?, policy_reasons jsonb /* ReasonCode[] */, requires_human_approval bool, created_at)`
- `escalations(id, support_request_id fk, proposed_action_id fk, order_id fk, status escalation_status default 'pending', version int default 0, decided_by_reviewer_id fk→users?, decision decision?, decision_note, decided_at, executed_at, resulting_refund_id fk?, resulting_cancellation_id fk?, created_at, updated_at)`
  - `idx_escalations_pending` partial index; **`AFTER INSERT OR UPDATE` trigger → `pg_notify('escalations_changed', json)`** for long-poll.
- `execution_attempts(id, action_type, order_id fk?, initiated_via, escalation_id fk?, agent_run_id fk?, reviewer_id fk?, outcome execution_outcome, guardrail_violation text?, detail jsonb, created_at)` — audits EVERY attempt incl. rejections + lost races.

**Seed:** 2–3 customers + 2 reviewers (`bcryptjs` hashes); orders covering every path — (a) unshipped paid (refundable+cancellable), (b) shipped (cancel rejected, refund ok), (c) already-refunded (2nd refund rejected), (d) an order owned by customer A used by a request from customer B (authz test); items + one captured payment each (`amount = total`).

> **`confidence` is advisory display-only — never a guardrail or policy input.** All safety decisions are deterministic (code + DB constraints), never model-confidence-based.

---

## Key mechanisms

**Policy Engine** (`src/services/policy.ts`) — pure, deterministic; the sole arbiter of execution mode. Returns `{ decision: 'AUTO' | 'ESCALATE' | 'REJECT', reasons: ReasonCode[] }`:
- **AUTO** — `WITHIN_LIMITS`: requester owns order AND (refund: `amount ≤ remainingRefundable` AND `amount ≤ AUTO_REFUND_MAX`) or (cancel: `shipped_at IS NULL` AND within window).
- **REJECT** (auto-decline; declining is always safe) — `ALREADY_SHIPPED` (cancel), `NOTHING_REFUNDABLE` (incl. already-refunded). Customer gets a clear decline message; no execution; logged; visible to reviewers under "All activity".
- **ESCALATE** (needs human judgment) — `ABOVE_AUTO_LIMIT`, `EXCEEDS_PAID`, `OUTSIDE_CANCEL_WINDOW`, `DAMAGED_GOODS`, `NOT_AUTHORIZED`, `ORDER_NOT_FOUND`, `AMBIGUOUS`, `AGENT_REQUESTED`, `REPLACEMENT_ALWAYS_REVIEWED`. **Replacement always → ESCALATE** (no auto path).

**Guarded Executor** (`src/services/guarded-executor.ts`, the ONLY mutation module; every path calls it; runs in one txn; checks after the row lock). Each rule has an app check **and** a DB backstop:

| Rule | App check (Guarded Executor) | DB backstop |
|---|---|---|
| Refund ≤ paid | `if amount.gt(paid.minus(refunded)) → GuardrailError('EXCEEDS_PAID')` (Decimal, under lock) | `CHECK(amount>0)` + sums under lock |
| No double refund | `if activeRefundCount>0 → 'ALREADY_REFUNDED'` | partial unique index (`23505`) |
| No cancel if shipped | `if order.shipped_at != null → 'ALREADY_SHIPPED'` | `BEFORE INSERT` trigger |

Every `GuardrailError` → 4xx + `execution_attempts(outcome='rejected_guardrail', …)`. **The Guarded Executor rejects unsafe actions even if the Policy Engine or a human approves them** — the last line of defense. `executeReplacement` (human-approval only) guards: requester owns order, order delivered, within `REPLACEMENT_WINDOW_DAYS`, no active replacement (partial unique index) — concurrency-safe by the same pattern as refunds.

**Concurrency** (READ COMMITTED + explicit locks): `SELECT … FOR UPDATE` on order/escalation (2nd request blocks) → guardrail reads under lock → `INSERT` claims the partial-index slot → `UPDATE … WHERE version=? RETURNING` (affected-rows==1). Provider call happens **outside** the txn keyed by `idempotency_key`. **Double-approval:** approval + execution in one atomic txn — lock escalation, `if status!='pending' → 409(current state)`, version CAS, run the same Guarded Executor. Loser gets 409 + authoritative state. Three independent guards; any one suffices.

**Agent tools (minimal; read/propose only, none mutate):**
- `getOrder({ orderNumber })` → order + items + payments + existing refunds + computed `refundableAmount`, **scoped to the authenticated requester** (returns not-accessible for others').
- `getCustomerOrders()` → the requester's orders (number, status, total) to resolve which order.
- `proposeRefund({ orderNumber, amount, reason, customerMessage })`, `proposeCancellation({ orderNumber, reason, customerMessage })`, `proposeReplacement({ orderNumber, itemSku?, reason, customerMessage })`, `escalate({ orderNumber?, reason, customerMessage })` — write a `proposed_actions` row + return an ack; execute nothing.

**Failure handling:** hallucinated order → `getOrder` returns not-found → agent escalates; Guarded Executor also throws `order_not_found`. Refund > payment → policy `EXCEEDS_PAID` (escalate) + guardrail throws + `CHECK`. Someone-else's order → session identity is the authz anchor (never form/model); read tools scope to it; policy `NOT_AUTHORIZED`; Guarded Executor re-verifies `not_authorized`.

---

## Verticals (ordered; each = implement → auto-tests → user verifies → proceed)

### V1 — Foundation + Data Model + Seed
Scaffold Next.js 15 + TS + **Tailwind** + ESLint/Prettier. `docker-compose.yml` (Postgres 16 + Adminer). `src/config.ts` (zod-validated env) + `.env`/`.env.example`/`.gitignore`. Drizzle + `pg` Pool (`src/db/client.ts`), `drizzle.config.ts`. Full schema (all `pgEnum`s, `users`, business, action = refunds/cancellations/replacements, trace, escalation), migrations incl. raw SQL for partial unique indexes (incl. `uniq_active_replacement_per_order`) + not-shipped trigger + `pg_notify` trigger. `src/db/seed.ts`. `/api/health` (DB ping).
- **Auto-tests:** config rejects missing/invalid env; DB connects + `/api/health` ok; migrate+seed idempotent; constraints reject bad data (2nd active refund → `23505`; cancel-shipped insert → trigger error; `amount>0` CHECK).
- **User verifies:** `docker compose up` + `npm run dev`; explore seeded data in **Adminer**; try violating a constraint.

### V2 — Simple Auth + Permission Middleware + SSR Shell
`src/lib/auth.ts` (bcrypt verify; jose sign/verify one session JWT; cookie helpers; `getSession()`), `src/lib/rbac.ts` (role→permissions map + route→required-permission map). Routes: `POST /api/auth/login|logout`. `middleware.ts` enforces per-route permissions from the code map (redirect `/login` or 403). SSR shell: `/login`, `/portal` (needs `request.create`), `/console` (needs `escalation.read`) with placeholder content + identity + logout.
- **Auto-tests:** login sets cookie / wrong password 401; expired/invalid token → unauthenticated; middleware blocks missing permission; rbac map unit tests.
- **User verifies:** log in as customer vs reviewer (two browsers), gated pages, logout.

### V3 — Guarded Executor: Guardrails + Concurrency  ⟵ graded core
`src/services/money.ts` (Decimal helpers), `src/services/errors.ts`, `src/services/guarded-executor.ts` (`executeRefund`, `executeCancellation`, `executeReplacement`, `executeRefundWithinTx`), `execution_attempts` logging. Dev-only harness `POST /api/dev/*` (NODE_ENV-guarded) for manual concurrent firing.
- **Auto-tests (integration, real Postgres):** `Promise.all` of N concurrent `executeRefund` on one order → exactly one succeeds, rest ConflictError, `refunds` shows one active row; each guardrail (EXCEEDS_PAID / ALREADY_REFUNDED / ALREADY_SHIPPED) rejected + logged; authorization rejected; idempotency-key replay → one refund; N concurrent replacements on one order → one active row; replacement guardrails (not-delivered / outside-window / already-replaced) rejected.
- **User verifies:** `npm run test:concurrency`; fire the dev endpoint concurrently (script provided); inspect `refunds`/`execution_attempts` in Adminer.

### V4 — Agent Loop + Policy Engine + Intake
`src/agent/llm.ts` (Gemini adapter), `src/agent/tools.ts` (2 read + 4 propose defs, zod), `src/agent/loop.ts` (manual loop + trace persistence + `decision_summary` + `final_message`), `src/services/policy.ts` (`AUTO`/`ESCALATE`/`REJECT` + reason codes). `POST /api/support-requests` (perm `request.create`; runs loop → policy → `AUTO`: Guarded Executor / `ESCALATE`: create escalation / `REJECT`: decline + log; returns decision + explanation).
- **Auto-tests (LLM adapter mocked):** small refund → AUTO; large refund → ESCALATE(`ABOVE_AUTO_LIMIT`); refund>paid → ESCALATE(`EXCEEDS_PAID`); already-refunded → REJECT(`NOTHING_REFUNDABLE`); cancel-unshipped → AUTO; cancel-shipped → REJECT(`ALREADY_SHIPPED`); hallucinated order → ESCALATE; someone-else's order → ESCALATE(`NOT_AUTHORIZED`); damaged → proposeReplacement → ESCALATE(`REPLACEMENT_ALWAYS_REVIEWED`); trace rows + `decision_summary` persisted. One live Gemini smoke test behind a flag.
- **User verifies:** submit a request (minimal form/dev endpoint), watch AUTO vs ESCALATE vs REJECT; reconstruct the run in Adminer.

### V5 — Reviewer Console + Decision + Long-Poll  ⟵ graded core
`POST /api/escalations/:id/decision` (perm `escalation.decide`; `{decision, expectedVersion, note}` → `approveEscalation` guarded execution / reject transition; 200|409). `GET /api/escalations`, `GET /api/escalations/:id` (+ trace). Long-poll `GET /api/escalations/updates` via `src/lib/notify.ts` (LISTEN/NOTIFY). Frontend `/console`: SSR queue + client long-poll live updates; `/console/[id]` escalation review with the **information hierarchy for decision speed** (top→bottom, no raw JSON first):
1. **Customer request** (verbatim) → 2. **AI recommendation** (the proposed action in plain language, rendered from the same `payload` the executor consumes — refund / cancellation / replacement all render uniformly, e.g. *"Refund $49.99 to Visa ••4242 for order #1043"* or *"Ship a replacement for SKU X on order #1043"*) → 3. **Why** (`decision_summary` + policy reasons as readable chips) → 4. **Order summary** (curated: total, items, status, prior refunds, age) → 5. **Collapsible agent trace** (tool calls in/out) → 6. **Approve / Reject** bar (disabled unless pending & idle; Approve → confirm modal restating the exact mutation).
- **Auto-tests:** double-approval — two concurrent decision POSTs, same `expectedVersion` → one 200, one 409; `escalations` executed once; one refund. Reject flow. Stale version → 409. Long-poll returns on NOTIFY and on timeout.
- **User verifies:** two reviewer logins in two browsers open the same escalation, both Approve → one wins, other shows "already approved by X"; queue updates live.

### V6 — Customer Portal + End-to-End
`/portal`: submit-request form (SSR + client submit), list own requests + outcome + agent explanation, long-poll their request status. Own-data scoping (authz). Full customer→reviewer flow wired.
- **Auto-tests:** submit → decision shown; portal lists own requests only.
- **User verifies:** end-to-end in the UI.

### V7 — Docs + Railway Deploy
`ARCHITECTURE.md` (1–3 pp; content + diagram below). `README.md` (docker-compose setup, `.env.example`, migrate/seed, seeded creds, live URL, how to reproduce concurrency + guardrail tests). Deploy to Railway (Next.js + Postgres; migrate+seed on release). Run verification suite against the live URL; push to public GitHub.
- **User verifies:** open the public URL; run the documented concurrency + guardrail checks against it.

---

## ARCHITECTURE.md content (V7 deliverable)

1. **Agent Boundary** — agent decides intent, Policy Engine decides mode, Guarded Executor is the only mutator (not prompts). 2. **Tool Design** — 2 read + 4 propose tools, requester-scoped data, tools never mutate; `confidence` advisory-only; no CoT stored. 3. **Failure Handling** — hallucinated IDs, refund>payment (3 layers), someone-else's order (3 layers). 4. **Build vs Buy** — built: Guarded Executor + idempotency, own trace tables, simple session auth, raw SDK loop, LISTEN/NOTIFY long-poll; would adopt at scale: pg-boss→BullMQ→Temporal, LangGraph/Mastra, Langfuse+OpenTelemetry, Sentry, pino→Datadog. Build the *patterns*, not the *heavy infra*. 5. **Design Decisions (with rejected alternatives):** (a) tools propose, Guarded Executor executes — rejected model-executes-directly; (b) version-CAS + row lock + partial unique index + idempotency — rejected last-write-wins and Redis locks; (c) long-poll via LISTEN/NOTIFY — rejected interval-polling and websockets.

**Diagram (include in the doc):**
```
        Customer request
               │
               ▼
        LLM Agent (Gemini)
        │  read tools: getOrder / getCustomerOrders
        ▼  propose tools: proposeRefund / proposeCancellation / proposeReplacement / escalate
        Proposed Action (intent only)
               │
               ▼
        Policy Engine  ──►  { AUTO | ESCALATE | REJECT, reasons[] }
        ┌──────────────┼───────────────┐
        ▼              ▼                ▼
      AUTO          ESCALATE          REJECT
        │              │                │
        │              ▼                ▼
        │         Reviewer          auto-decline
        │         (Approve)         + explanation
        │              │
        └──────┬───────┘
               ▼
        GUARDED EXECUTOR  (one Postgres txn)
        · FOR UPDATE row lock  · guardrails  · partial unique index
        · version CAS  · idempotency key
               │
               ▼
          PostgreSQL  (refunds / cancellations + full trace)
```
"**Every state-changing operation passes through the Guarded Executor.**"

---

## Critical files
`src/config.ts`, `docker-compose.yml`, `src/db/schema.ts` + migrations, `src/db/seed.ts`, `src/lib/auth.ts`, `src/lib/rbac.ts`, `middleware.ts`, `src/services/money.ts`, `src/services/guarded-executor.ts` (guardrails+concurrency), `src/services/policy.ts` (AUTO/ESCALATE/REJECT), `src/agent/{llm,tools,loop}.ts`, `src/lib/notify.ts` (LISTEN/NOTIFY), `src/app/api/support-requests/route.ts`, `src/app/api/escalations/[id]/decision/route.ts`, `src/app/api/escalations/updates/route.ts`, `src/app/console/**`, `src/app/portal/**`.

## Global verification (per-vertical + finally against Railway)
Double-refund (N concurrent → 1 row) · double-approval (two browsers/requests → executes once, loser 409) · guardrails (EXCEEDS_PAID / ALREADY_REFUNDED / ALREADY_SHIPPED all rejected + logged) · authorization (customer B on A's order → escalate/reject) · traceability (walk `support_requests → agent_runs → messages/tool_calls → proposed_actions → escalations → refunds/execution_attempts` in SQL).
