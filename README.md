# Support Operations Console

An AI agent triages e-commerce support requests (refunds, cancellations, replacements) and a human-reviewer console approves or rejects the risky ones. Built so the **human-approval boundary, guardrails, and concurrency safety are real system properties** — enforced in application code and the database, not in the prompt.

- **Live demo:** _<add your Railway URL here after deploy>_
- **Architecture & design rationale:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)

**Stack:** Next.js 16 (App Router) · PostgreSQL 16 · Drizzle ORM · Google Gemini (`@google/genai`, real tool-calling loop) · TanStack Query + Postgres LISTEN/NOTIFY · Vitest.

## Beyond the brief

Beyond the required functionality, I expanded the application into a more complete support operations platform by adding customer and reviewer dashboards, operational analytics, an order management view, richer seed data, and a polished design system. These additions were intentionally kept separate from the core safety architecture so they enhanced the product without compromising the concurrency, guardrails, or human-approval boundary.

**What was added**
- **Customer portal** — a dashboard (KPIs + charts), order creation (pick catalog items; no checkout) and an orders list, and a requests view that now shows the reviewer's decision note.
- **Reviewer console** — an operations dashboard (pie/bar/area charts, avg time-to-decision, policy-reason breakdown), a **Customers** page (revenue / orders / refunds per customer), an **Orders** page to manage order status, and a filterable **Requests** queue with KPI counts.
- **Design system** — a light, token-based UI (Untitled UI–inspired) with a reusable component + Recharts chart library.

Marking an order **paid** mints the captured payment the refund/cancellation guardrails rely on, so customer-created orders flow into the exact same triage path — the safety core is reused, never bypassed. See [`ARCHITECTURE.md`](./ARCHITECTURE.md#product-surface-beyond-the-core-additive-same-safety-discipline) for details.

## Demo accounts (password: `password123`)

| Role | Email | Lands on |
|---|---|---|
| Customer | `alice@example.com` | `/portal` |
| Customer | `bob@example.com` | `/portal` |
| Reviewer | `rae@support.example.com` | `/console` |
| Reviewer | `sam@support.example.com` | `/console` |

Plus four more seeded customers (Olivia, Phoenix, Lana, Candice) visible in the reviewer's Customers view.

Seeded data: **6 customers**, **~17 orders** spanning every status (anchors **1001** open/$40 auto-refundable · **1002** shipped/$120 · **1003** already refunded · **1004** delivered/$80 · **1005** Bob's authorization test), and support requests across every status. **Four escalations are pre-seeded** — two **pending** (so the console is reviewable immediately) plus an **approved** and a **declined** example, each carrying a reviewer note that's visible in the customer's portal.

---

## Run locally

**Prerequisites:** Node 20+, Docker Desktop.

```bash
# 1. Start Postgres + Adminer (DB explorer at http://localhost:8080)
docker compose up -d

# 2. Configure env
cp .env.example .env      # then set GEMINI_API_KEY (from https://aistudio.google.com/apikey) and AUTH_SECRET

# 3. Install, migrate, seed
npm install
npm run db:migrate
npm run db:seed

# 4. Run
npm run dev               # http://localhost:3000
```

Open http://localhost:3000 and sign in with a demo account from the table above.

> **Note on the agent:** the customer portal's "submit" calls the live Gemini API. The free tier has a low request cap (e.g. ~20/day on some keys); if you hit it, submissions return a friendly "rate-limited" message. **Everything else — the reviewer console, approvals, guardrails, and all concurrency tests — is LLM-independent** and works regardless (the two pre-seeded escalations let you exercise the full review flow immediately).

## Tests

```bash
npm test                  # full suite (unit + integration, ~84 tests)
npm run test:concurrency  # double-refund / double-cancel / double-approval + guardrails
```
Integration tests run against a dedicated `support_console_test` database (created automatically by `docker compose`).

## Reproduce the graded checks

**Guardrails + double-refund (dev-only HTTP harness):**
```bash
# 8 concurrent refunds on one order -> exactly ONE succeeds; inspect the refunds table in Adminer
curl -s -X POST localhost:3000/api/dev/execute -H "content-type: application/json" \
  -d '{"action":"refund","orderNumber":1002,"amount":"50.00","count":8}'
# -> {"summary":{"executed":1,"conflict":7,...}}   and refunds has exactly ONE row for order 1002

# guardrail: cancelling a shipped order is refused
curl -s -X POST localhost:3000/api/dev/execute -H "content-type: application/json" \
  -d '{"action":"cancellation","orderNumber":1002,"count":1}'   # -> guardrail ALREADY_SHIPPED
```

**Double-approval (two browsers):** sign in as `rae` and `sam` in two sessions, both open the same pending escalation in `/console`, both click **Approve** → one succeeds, the other shows "already approved by …", and the refund executes **exactly once**. Decisions propagate to the other session within ~2s (long-poll).

**Guardrails via the agent:** submit "refund order 1002" (>$50 → escalates), "cancel order 1002" (shipped → declined), "another refund for order 1003" (already refunded → declined).

## Key files

| Concern | File |
|---|---|
| **Guardrails + concurrency** (the only mutation path) | `src/services/guarded-executor.ts` |
| **Policy Engine** (AUTO / ESCALATE / REJECT) | `src/services/policy.ts` |
| **Reviewer decisions** (double-approval exactly-once) | `src/services/escalations.ts` |
| Agent loop + tools | `src/agent/{loop,tools,llm}.ts` |
| Intake orchestration | `src/services/intake.ts` |
| Long-poll (LISTEN/NOTIFY) | `src/lib/notify.ts` |
| Schema + migrations | `src/db/schema.ts`, `drizzle/` |
| Config (single env entry point) | `src/config.ts` |

## Deployment (Railway)

The app runs as a single persistent container (chosen over serverless so the agent loop and the LISTEN/NOTIFY long-poll work without connection-pooling gymnastics). `railway.json` sets the start command to `npm run start:prod`, which **migrates**, **seeds if empty**, then starts Next.js.

1. Create a Railway project from this GitHub repo; add the **PostgreSQL** plugin (provides `DATABASE_URL`).
2. Set service variables: `AUTH_SECRET` (long random string), `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.1-flash-lite`), `NODE_ENV=production`. Optional tuning: `AUTO_REFUND_MAX`, `CANCEL_AUTO_WINDOW_HOURS`, `REPLACEMENT_WINDOW_DAYS`.
3. Deploy. Railway builds with Nixpacks (`next build`) and runs `start:prod`.

## Environment variables

See [`.env.example`](./.env.example). All env access is centralized and zod-validated in `src/config.ts`, so the app fails fast on misconfiguration.
