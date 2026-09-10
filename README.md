# Property Management SaaS

A multi-tenant property management platform for landlords, property owners, property managers and
businesses running portfolios of properties, buildings, units, tenants, leases, rent, payments,
expenses, maintenance, staff and documents.

**Current state: Phase 4 (Rent, Payments, Receipts & Expenses) complete.** On top of the Phase 1
foundation (accounts, sessions, roles, permissions, audit trail), the Phase 2 portfolio
(properties, buildings, units, property scoping) and the Phase 3 occupancy layer (tenants, leases,
expiry tracking), the product now handles money: generate a month's rent from active leases,
record payments against those charges in a single locked transaction, issue gapless numbered
receipts you can print, void a payment without losing the record, and track what each property
costs to run. Every amount is `Decimal` from the database to the browser — no financial value is
ever a JavaScript number.
Maintenance, documents, staff management and reports arrive in Phases 5–6 — see
[`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) §21.

Phase notes: [`docs/PHASE-1.md`](docs/PHASE-1.md) · [`docs/PHASE-2.md`](docs/PHASE-2.md) ·
[`docs/PHASE-3.md`](docs/PHASE-3.md) · [`docs/PHASE-4.md`](docs/PHASE-4.md)

---

## Contents

- [Architecture](#architecture)
- [Technologies](#technologies)
- [Project structure](#project-structure)
- [Requirements](#requirements)
- [Getting started with Docker](#getting-started-with-docker)
- [Getting started without Docker](#getting-started-without-docker)
- [Environment variables](#environment-variables)
- [Database, migrations and seed](#database-migrations-and-seed)
- [Running the apps](#running-the-apps)
- [Testing](#testing)
- [API documentation](#api-documentation)
- [Security](#security)
- [Deployment](#deployment)
- [Development workflow](#development-workflow)
- [What is and is not built yet](#what-is-and-is-not-built-yet)

---

## Architecture

```
Browser
  │  HTTPS, HTTP-only cookie session + X-CSRF-Token
  ▼
Next.js (App Router)          no database access, no authoritative business logic
  │  REST /api/v1
  ▼
NestJS modular monolith       rate limit → authenticate → CSRF → tenant context → authorize
  │  Prisma (tenant-scoped client)
  ▼
PostgreSQL 16                 Decimal money, composite FKs carrying organizationId
```

Full design, including the ERD, RBAC matrix, financial flows and phase plan:
[`docs/BLUEPRINT.md`](docs/BLUEPRINT.md).

## Technologies

| Layer | Choice |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, Radix primitives, TanStack Query, React Hook Form, Zod, Recharts |
| Backend | Node.js 20+, NestJS 11, TypeScript, REST, Swagger/OpenAPI |
| Database | PostgreSQL 16 |
| ORM | Prisma 6 |
| Auth | Postgres-backed cookie sessions, Argon2id |
| Authorization | RBAC (47 permissions × 6 roles) + per-organization isolation |
| Testing | Jest, Supertest, Vitest, Playwright |
| Tooling | pnpm workspaces, Docker Compose |

## Project structure

```
apps/api               NestJS API (modules, guards, tenancy, providers)
apps/web               Next.js app (App Router, feature slices, shared UI)
packages/config        shared tsconfig bases
packages/database      the generated Prisma client, wrapped as a workspace package
packages/types         permissions, roles, API contracts shared by both apps
packages/validation    Zod schemas and the password policy, shared by both apps
packages/ui            design tokens and the Tailwind preset
prisma/                schema.prisma (source of truth), migrations, seed
tests/e2e              Playwright specs
docs/                  BLUEPRINT.md and supporting documents
deploy/                Caddyfile for the production proxy
```

## Requirements

- **Node.js 20+** and **pnpm 9+** (`corepack enable`)
- **PostgreSQL 16**, or **Docker** + **Docker Compose**

## Getting started with Docker

```bash
cp .env.example .env
# Set SESSION_SECRET to a real value:
#   openssl rand -base64 48
# In .env set DATABASE_URL host to "postgres" for the Docker network:
#   postgresql://pm:pm_password@postgres:5432/property_management?schema=public

docker compose up -d          # postgres, api, web
docker compose exec api pnpm db:seed:demo
```

- Web: <http://localhost:3000>
- API: <http://localhost:3001/api/v1>
- Swagger: <http://localhost:3001/api/docs>

## Getting started without Docker

```bash
corepack enable
pnpm install

cp .env.example .env
# 1. Put a real SESSION_SECRET in .env      (openssl rand -base64 48)
# 2. Point DATABASE_URL and TEST_DATABASE_URL at your PostgreSQL

createdb property_management
createdb pm_test

pnpm db:generate      # generate the Prisma client
pnpm db:migrate       # apply migrations
pnpm db:seed:demo     # permissions, system roles, and two demo organizations

pnpm dev              # builds shared packages, then runs api + web together
```

Demo sign-in (development and test databases only):

| Email | Role |
|---|---|
| `owner@abc.test` | Property Owner |
| `manager@abc.test` | Property Manager |
| `accountant@abc.test` | Accountant |
| `caretaker@abc.test` | Caretaker |
| `owner@xyz.test` | Property Owner of a **second** organization |

Password for all of them: `DemoPassword123`

The second organization exists so you can confirm for yourself that ABC never sees XYZ's data.

## Environment variables

All variables are documented with defaults in [`.env.example`](.env.example). The API validates the
entire environment with a Zod schema **at boot and refuses to start** if anything is missing or
malformed — a missing `SESSION_SECRET` stops the process rather than silently becoming `''`.

The ones you must set:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `TEST_DATABASE_URL` | A **throwaway** database — the integration suite deletes rows in it |
| `SESSION_SECRET` | ≥ 32 characters. Rotating it invalidates every session, by design |
| `CORS_ORIGIN` | Comma-separated allow-list. Never `*` — credentials are sent on every request |
| `COOKIE_SECURE` | Must be `true` in production; boot fails otherwise |

Anything prefixed `NEXT_PUBLIC_` is compiled into the browser bundle and must never hold a secret.

## Database, migrations and seed

```bash
pnpm db:generate        # regenerate the Prisma client after a schema change
pnpm db:migrate         # create + apply a migration (development)
pnpm db:migrate:deploy   # apply existing migrations (test, staging, production)
pnpm db:reset           # drop, re-migrate and re-seed (development only)
pnpm db:seed            # permissions + system roles — safe in every environment
pnpm db:seed:demo       # the above plus two demo organizations (never in production)
pnpm db:studio          # browse the data
```

`prisma/schema.prisma` is the source of truth. Migrations are committed and never hand-edited,
except for the deliberate hand-written SQL migrations that add objects Prisma cannot express:
partial unique indexes and `CHECK` constraints (see
`prisma/migrations/*_invariant_constraints/migration.sql`).

Both seeds are idempotent: running them twice changes nothing the second time.

## Running the apps

```bash
pnpm dev            # api (3001) + web (3000)
pnpm dev:api
pnpm dev:web
pnpm build          # generate client, build packages, build both apps
pnpm start          # run the production builds
```

## Testing

```bash
pnpm test              # unit tests, both apps
pnpm test:api          # Jest unit tests (API)
pnpm test:e2e:api      # Supertest integration tests against a real PostgreSQL
pnpm test:web          # Vitest (web)
pnpm test:e2e          # Playwright, desktop + mobile viewports
```

The integration suite prepares its own database (migrate + seed) on every run, so a schema change
can never leave it testing yesterday's tables. It runs against a **real** PostgreSQL rather than a
mocked Prisma client, because the unique indexes and check constraints are precisely what needs
proving.

Playwright needs both servers already running (`pnpm dev`), and the API started with raised auth
rate limits — the suite registers more organizations in a minute than the production limit allows:

```bash
AUTH_REGISTER_LIMIT=500 AUTH_LOGIN_LIMIT=500 AUTH_SENSITIVE_LIMIT=500 pnpm dev:api
pnpm test:e2e
```

## API documentation

Swagger UI is served at `/api/docs` when `SWAGGER_ENABLED=true` (default in development, off in
production). Every endpoint documents its request, response, required permission and error cases.

## Security

Implemented and covered by tests:

- **Argon2id** password hashing; a dummy verification runs on the unknown-email path so response
  timing cannot be used to discover which addresses are registered
- **Opaque session tokens** — the database stores only a SHA-256 hash, so a dump cannot be replayed
- **HTTP-only, SameSite=Lax cookies**, `Secure` in production; nothing in `localStorage`
- **Signed double-submit CSRF** bound to the session, constant-time compared
- **Deny-by-default authorization** — a route that declares no policy is refused, not opened
- **Four-layer tenant isolation** — session-derived `organizationId`, a tenant-scoping Prisma
  extension that throws rather than running unscoped, service-level checks, and `404` (never `403`)
  for another organization's records
- **`whitelist` + `forbidNonWhitelisted` validation** — a request that tries to send
  `organizationId` is rejected outright
- **Rate limiting** on registration, sign-in and password reset; account lockout after 10 failures
- **Uniform error envelope** with a request id; no stack traces or driver errors leave the server
- **Append-only audit log** that redacts anything credential-shaped and never breaks a request
- **Money is `Decimal` end to end** — `Decimal(14, 2)` in PostgreSQL, `Prisma.Decimal` in the
  service layer, a fixed-scale string on the wire; no financial value is ever a JavaScript number
- **Payments are written under a row lock** in one transaction, so two concurrent payments cannot
  both settle the same balance, and any failure rolls the whole thing back
- **Financial records are never cascade-deleted** — every money relation is `onDelete: Restrict`,
  and a unit or property carrying charges refuses deletion with a message naming the counts

The full checklist, including what is deferred to the Phase 7 hardening pass, is in
[`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) §23; what each phase delivered is in
[`docs/PHASE-1.md`](docs/PHASE-1.md) through [`docs/PHASE-4.md`](docs/PHASE-4.md).

## Deployment

```bash
docker compose -f docker-compose.prod.yml run --rm migrate   # must exit 0 first
docker compose -f docker-compose.prod.yml up -d
```

Both images are multi-stage and run as a non-root user with a healthcheck. Migrations run as a
separate one-shot service, never inside the application process, so a bad migration cannot be
retried forever by a restarting container. Caddy terminates TLS and is the only service published
to the host. Rolling back is redeploying the previous image tag, which is why migrations are
written forward-compatible: additive first, destructive only one release after the code stops using
the column.

## Development workflow

1. Change `prisma/schema.prisma` → `pnpm db:migrate` → `pnpm db:generate`.
2. Add a permission to `packages/types/src/permissions.ts` and the matrix reconciles on next seed.
3. Build the module: `controller` (thin) → `service` (rules) → repository (Prisma).
4. Declare access on every route: `@Public`, `@AuthenticatedOnly` or `@RequirePermissions`.
   Forgetting is a 403, not an open door.
5. Add the endpoint to the isolation and permission suites before calling it done.
6. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e:api`.

## What is and is not built yet

**Working now (Phases 1–4):** registration, sign-in/out, sessions and device revocation, password
change and reset, email verification flow, organization and settings management, the user
directory, roles and permissions, the app shell and the audit trail; properties, buildings and
units with full CRUD, archive-vs-delete rules, unit status handling, server-side search,
filtering, sorting and pagination, and property scoping; tenants with a 360 profile, and the full
lease lifecycle — create, renew, terminate — with expiry tracking and one active lease per unit;
monthly rent generation, payments recorded in a single locked transaction, gapless numbered
receipts with a print view, payment voiding that reverses without deleting, and expense tracking
by category.

**Deliberately not built yet:** maintenance requests, staff management, documents, notifications,
dashboard metrics and reports. They are specified in the blueprint and scheduled in Phases 5–6.

**Honest gaps in what is built:**

- **Email is not delivered.** The `EmailProvider` port and both flows (verification and password
  reset) are fully implemented; the Version 1 adapter writes the link to the server log instead of
  sending it. Nothing in the UI claims an email was sent. Supplying SMTP credentials and switching
  `EMAIL_DRIVER` makes it live without changing any domain code.
- **Staff assignments have no UI yet.** Property scoping is fully enforced and tested, but the
  screens for creating staff and granting them properties are the Phase 5 StaffModule. Today
  assignments come from the seed or the database directly.
- **No M-Pesa integration.** M-Pesa payment references are typed by hand, and the payment dialog
  says so. Nothing is fetched from Safaricom, and no reconciliation is automatic.
- **No credit balances.** A payment larger than the outstanding balance is refused with a 422
  naming the amount owing, rather than absorbed as credit — carrying credit forward has real rules
  (rollover, refund on move-out) that belong in a version that implements them properly.
- **No receipt email or PDF export.** A receipt prints from the browser; the printed page is the
  receipt and none of the app around it.
- **No late fees, pro-rata or profit-and-loss report.** Rent is billed in whole months, `OVERDUE`
  is reported but never charged for, and the reporting module — which is where net income belongs
  — is Phase 6.
- **Deposits are recorded, not ledgered.** `depositPaid` is tracked and capped at the security
  deposit; deductions and move-out refunds are out of V1 scope, and no rent payment is ever taken
  from a deposit.
- **Password strength** is a policy check plus a small common-password blocklist, not full
  dictionary scoring. Deferred to Phase 7.
