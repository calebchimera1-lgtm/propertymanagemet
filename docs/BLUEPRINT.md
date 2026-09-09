# Property Management SaaS — Technical Blueprint (V1)

**Status:** Blueprint for review. No application code has been written yet.
**Scope:** Version 1 (commercial MVP) as defined in the Master Technical Specification.
**Stack (locked):** Next.js/React/TS/Tailwind/shadcn/ui · NestJS/TS/REST/Swagger · PostgreSQL · Prisma · pnpm workspaces · Docker Compose.

---

## 0. Decisions taken in this blueprint

The master spec left a small number of points to engineering judgement. These are the calls made,
so they can be challenged before any code exists.

| # | Point | Decision | Why |
|---|---|---|---|
| D1 | Session storage | Opaque random token in an HTTP-only cookie; only a SHA-256 hash of the token stored in a Postgres `Session` row | Allows instant revocation and session listing; no Redis; token is never recoverable from a DB dump |
| D2 | CSRF strategy | Signed double-submit token: non-HttpOnly `pm.csrf` cookie + `X-CSRF-Token` header, bound to the session id, required on all unsafe methods | Correct companion to cookie auth; no server-side token store needed |
| D3 | Cookie site model | Web and API served from the same registrable domain (`app.example.com` / `api.example.com`), cookie `Domain=.example.com`, `SameSite=Lax` | Same-site in both dev (`localhost:3000`→`:3001`) and prod; avoids `SameSite=None` |
| D4 | Money type | `Decimal(14,2)` in Postgres, `Prisma.Decimal` (decimal.js) in the API, **string** over JSON, formatted only in the UI | No float anywhere on an authoritative path; JSON numbers cannot hold Decimal safely |
| D5 | Currency | Single currency per organization (`Organization.currency`, default `KES`); no FX in V1 | Multi-currency is a V4 concern; storing it now keeps the door open |
| D6 | Tenant isolation enforcement | Three layers: Prisma Client extension driven by AsyncLocalStorage tenant context (primary) + explicit service-level ownership checks + Postgres RLS as Phase 7 defence-in-depth | A single mechanism is one bug away from a cross-tenant leak |
| D7 | `EXPIRING_SOON` / `OVERDUE` | **Derived** states, not hand-set. Computed by a scheduled job that transitions rows, and by query predicates in reads | Two sources of truth for status is how financial reports start lying |
| D8 | Rent record generation | Idempotent generator: `@nestjs/schedule` nightly job + manual "generate period" action, protected by `UNIQUE (leaseId, periodStart)` | Cron re-runs, container restarts and manual clicks must never double-bill |
| D9 | Receipt numbering | Per-organization sequence via a `NumberSequence` row locked `FOR UPDATE` inside the payment transaction; format `RCP-{orgCode}-{YYYY}-{000001}` | Gapless and unique per org; a Postgres sequence would leak gaps and cross-tenant counts |
| D10 | Payment→rent application | A payment carries `rentRecordId` (nullable) and an explicit allocation step; overpayment beyond the record's balance is rejected in V1 | Credit balances/auto-allocation are real accounting features — deliberately deferred, not faked |
| D11 | `TENANT` / `SUPER_ADMIN` roles | Exist in the schema and permission matrix; no login surface in V1 | Spec: architecture now, functionality later |
| D12 | Turborepo | Not used. Plain pnpm workspaces + `pnpm -r` scripts | Spec §4 |

**Open questions for you (do not block the blueprint):**
- Q1 — Should a `PROPERTY_MANAGER` be able to delete a property, or only archive it? (Blueprint assumes **archive only**; delete is `PROPERTY_OWNER`.)
- Q2 — Is partial-month/pro-rata rent required in V1 for leases that start mid-month? (Blueprint assumes **full month billed from the first period whose `dueDay` falls on/after `startDate`**, no pro-rata.)
- Q3 — Do you want a security deposit tracked as a *liability ledger* (refundable, deductible) in V1, or just a recorded amount on the lease? (Blueprint assumes **recorded amount + one deposit transaction record**, no full deposit ledger.)

---

## 1. Final architecture diagram

```
                                  ┌─────────────────────────────┐
                                  │          Browser            │
                                  │  Desktop / Tablet / Mobile  │
                                  └──────────────┬──────────────┘
                                                 │ HTTPS
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  apps/web — Next.js (App Router, React, TypeScript)                          │
│                                                                              │
│  • Route groups: (auth) public  ·  (app) authenticated shell                 │
│  • Server Components: shell, layout, static chrome                           │
│  • Client Components: tables, forms, charts, dialogs                         │
│  • TanStack Query = the ONLY server-state cache                              │
│  • React Hook Form + Zod = form shape validation (NOT business rules)         │
│  • middleware.ts: presence-of-session-cookie redirect only (cosmetic guard)   │
│                                                                              │
│  NO database access. NO authoritative business logic. NO money arithmetic.    │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │  fetch(credentials:'include')
                               │  X-CSRF-Token on unsafe methods
                               │  HTTPS  →  /api/v1/*
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  apps/api — NestJS Modular Monolith (TypeScript)                             │
│                                                                              │
│  ── Edge ──────────────────────────────────────────────────────────────────  │
│   Helmet · CORS(allow-list, credentials) · Throttler · cookie-parser          │
│   ValidationPipe(whitelist, forbidNonWhitelisted, transform)                  │
│   AllExceptionsFilter → RFC-style error envelope (never leaks stack traces)   │
│                                                                              │
│  ── Request pipeline (order is load-bearing) ──────────────────────────────  │
│   1. RateLimitGuard        per-IP / per-route buckets                         │
│   2. CsrfGuard             unsafe methods only, signed double-submit          │
│   3. SessionAuthGuard      cookie → hashed lookup → User + Organization       │
│   4. TenantContextInterceptor   AsyncLocalStorage.run({ orgId, userId, ... }) │
│   5. PermissionsGuard      @RequirePermissions('payments.create')             │
│   6. PropertyScopeGuard    staff restricted to assigned properties            │
│   7. Controller (thin)  →  Service (rules)  →  Repository (Prisma)            │
│   8. AuditInterceptor      writes AuditLog for mutating, decorated routes     │
│                                                                              │
│  ── Domain modules ────────────────────────────────────────────────────────  │
│   Auth · Organizations · Users · Roles · Permissions · Properties ·           │
│   Buildings · Units · Tenants · Leases · Rent · Payments · Receipts ·         │
│   Expenses · Maintenance · Staff · Documents · Notifications · Reports ·      │
│   AuditLogs · Settings                                                       │
│                                                                              │
│  ── Provider ports (interfaces, swappable) ────────────────────────────────  │
│   FileStorageProvider │ EmailProvider │ SmsProvider │ WhatsAppProvider │      │
│   PaymentGatewayProvider    ── V1 adapters: Local FS, Console/No-op, Manual   │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │  Prisma Client
                               │  + tenant-scoping extension
                               │  + $transaction for financial writes
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  PostgreSQL 16   ·   Prisma migrations   ·   Decimal(14,2) money             │
│  Indexes on every organizationId + hot filter column                          │
│  Partial unique indexes enforcing business invariants                         │
│  (Phase 7) Row-Level Security keyed on app.current_org                        │
└──────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────────┐
                    │ File storage             │
                    │ dev: ./storage/uploads   │
                    │ prod: S3-compatible      │
                    │ (metadata only in PG)    │
                    └──────────────────────────┘
```

**Non-negotiables encoded in this diagram**
1. The browser never reaches PostgreSQL.
2. Every request that touches tenant data passes guards 3→6 before a service runs.
3. `organizationId` is derived from the session at step 3 and is never read from the request body.
4. Every money mutation happens inside a `$transaction`.

---

## 2. Monorepo folder structure

```
property-management/
├── apps/
│   ├── api/                            NestJS modular monolith
│   │   ├── src/
│   │   │   ├── main.ts                 bootstrap, helmet, cors, cookies, swagger
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   ├── decorators/         @CurrentUser @RequirePermissions @Audit @Public
│   │   │   │   ├── guards/             session-auth, permissions, csrf, property-scope
│   │   │   │   ├── interceptors/       tenant-context, audit, serialize
│   │   │   │   ├── filters/            all-exceptions.filter.ts
│   │   │   │   ├── pipes/              parse-decimal.pipe.ts
│   │   │   │   ├── dto/                pagination.dto.ts, date-range.dto.ts
│   │   │   │   ├── errors/             domain error classes → HTTP mapping
│   │   │   │   └── money/              decimal helpers, rounding policy
│   │   │   ├── config/                 typed env config (Zod-validated)
│   │   │   ├── prisma/                 PrismaService + tenant-scope extension
│   │   │   ├── tenancy/                AsyncLocalStorage tenant context
│   │   │   ├── providers/              storage/ email/ sms/ whatsapp/ payment-gateway/
│   │   │   └── modules/                <one folder per domain module — see §3>
│   │   ├── test/                       e2e (Supertest) specs + fixtures
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   ├── jest.config.ts
│   │   └── package.json
│   │
│   └── web/                            Next.js App Router
│       ├── src/
│       │   ├── app/                    <see §4>
│       │   ├── components/             app-shell, data-table, forms, charts, states
│       │   ├── features/               one folder per domain: hooks + api + schemas
│       │   ├── lib/                    api-client, query-client, formatters, utils
│       │   ├── hooks/                  useSession, useDebounce, useTableParams
│       │   └── styles/globals.css
│       ├── public/
│       ├── middleware.ts
│       ├── next.config.mjs
│       ├── tailwind.config.ts
│       ├── components.json             shadcn/ui config
│       ├── vitest.config.ts
│       └── package.json
│
├── packages/
│   ├── types/                          shared DTO/response types, enums, API contracts
│   ├── validation/                     Zod schemas shared by web + api boundary tests
│   ├── ui/                             shared shadcn-based primitives + brand tokens
│   └── config/                         eslint, prettier, tsconfig bases
│
├── prisma/
│   ├── schema.prisma                   single source of truth for the database
│   ├── migrations/                     generated, committed, never hand-edited
│   └── seed/
│       ├── index.ts
│       ├── permissions.ts              canonical permission + role-permission matrix
│       └── demo.ts                     two organizations of realistic sample data
│
├── docs/
│   ├── BLUEPRINT.md                    this document
│   ├── ARCHITECTURE.md
│   ├── SECURITY.md
│   ├── DATA-MODEL.md
│   ├── API.md
│   └── DEPLOYMENT.md
│
├── tests/
│   └── e2e/                            Playwright specs + fixtures
│
├── docker-compose.yml
├── docker-compose.prod.yml
├── package.json                        root scripts only
├── pnpm-workspace.yaml
├── .env.example
├── .gitignore
└── README.md
```

**Why `prisma/` sits at the root rather than inside `apps/api`:** the spec names it as the database
source of truth for the whole product, and the seed scripts and migration tooling are run by CI and
by Docker entrypoints that should not need to know about the API's internal layout. The API imports
the generated client through a workspace path.

**Root scripts (illustrative, not code):** `dev`, `build`, `lint`, `typecheck`, `test`,
`test:e2e`, `db:migrate`, `db:reset`, `db:seed`, `db:studio`.

---

## 3. NestJS module structure

Every domain module follows the same shape, so a new module is never a design discussion:

```
modules/<domain>/
├── <domain>.module.ts
├── <domain>.controller.ts        thin: parse, delegate, serialize. No rules.
├── <domain>.service.ts           business rules, authorization checks, orchestration
├── <domain>.repository.ts        all Prisma access for this domain
├── dto/
│   ├── create-<x>.dto.ts         class-validator + @ApiProperty
│   ├── update-<x>.dto.ts
│   └── query-<x>.dto.ts          search / filter / sort / paginate
├── entities/<x>.entity.ts        API response shape (serialization contract)
└── <domain>.service.spec.ts
```

### Module map and responsibilities

| Module | Owns | Key rules it enforces |
|---|---|---|
| **AuthModule** | register, login, logout, me, forgot/reset password, verify email, change password, session list/revoke | Argon2id hashing, session issuance/rotation, generic failure messages, login throttling |
| **OrganizationsModule** | organization CRUD, org bootstrap on registration, org settings | An owner is created atomically with the org; org code uniqueness |
| **UsersModule** | user profile, activation/deactivation | A user cannot deactivate themselves; last owner cannot be removed |
| **RolesModule** | role definitions, role assignment | Only `PROPERTY_OWNER`/`SUPER_ADMIN` may grant roles; no privilege escalation above own role |
| **PermissionsModule** | permission registry, resolution of role→permissions | Permissions are seeded constants, not user-editable in V1 |
| **PropertiesModule** | property CRUD, archive | Delete blocked when active leases or financial history exist → archive instead |
| **BuildingsModule** | building CRUD | Building must belong to a property in the same org |
| **UnitsModule** | unit CRUD, status transitions | Status is derived from leases; manual override limited to `MAINTENANCE`/`UNAVAILABLE` |
| **TenantsModule** | tenant CRUD, tenant 360 profile | Delete blocked when leases/payments exist |
| **LeasesModule** | lease lifecycle, termination | **No two ACTIVE leases on one unit**; dates coherent; unit/building/property all same org and consistent |
| **RentModule** | rent record generation, balances, outstanding queries | Idempotent generation; balance = expected − allocated; status derivation |
| **PaymentsModule** | record payment, list, void (owner-only, audited) | Transactional: payment + allocation + rent status + receipt + audit, or nothing |
| **ReceiptsModule** | receipt issue, lookup, print/PDF payload | Gapless per-org numbering; receipts are immutable |
| **ExpensesModule** | expense CRUD + attachments | Amount > 0; property must be in scope; feeds P&L |
| **MaintenanceModule** | requests, assignment, status updates, cost tracking | Legal status transitions only; `completedAt` set exactly when `COMPLETED` |
| **StaffModule** | staff accounts, role assignment, property assignment, deactivate | Assignments define the data scope for `CARETAKER`/`ACCOUNTANT` |
| **DocumentsModule** | upload, metadata, authorized download, delete | MIME+extension+size+magic-byte validation; org ownership on every read |
| **NotificationsModule** | in-app notifications, read state, generators | Generated by domain events + scheduled jobs; no external channels in V1 |
| **ReportsModule** | the 9 V1 reports + export payloads | Read-only; all aggregates computed in SQL/Decimal, never in the browser |
| **AuditLogsModule** | append-only audit trail, authorized reading | Insert-only; never logs secrets; failures never break the request |
| **SettingsModule** | org settings (currency, timezone, rent day defaults, receipt prefix) | Change is audited |

### Cross-cutting infrastructure modules

- `PrismaModule` — `PrismaService` + the tenant-scoping client extension.
- `TenancyModule` — `AsyncLocalStorage` store carrying `{ userId, organizationId, roles, permissions, scopedPropertyIds }`.
- `SchedulerModule` — `@nestjs/schedule` jobs: nightly rent generation, overdue transition, lease-expiry notifications, expired-session sweep.
- `HealthModule` — `/health/live`, `/health/ready` (DB ping).
- `ProvidersModule` — binds the five provider ports to their V1 adapters via DI tokens.

### Module dependency direction

```
Auth ──► Users ──► Organizations ──► Roles ──► Permissions
                         ▲
                         │ (tenant context)
Properties ─► Buildings ─► Units
                             ▲
Tenants ────────► Leases ────┘
                    │
                    ▼
                  Rent ──► Payments ──► Receipts
                              │
Expenses ─────────────────────┼──────────► Reports
Maintenance ──────────────────┤
Staff · Documents · Notifications · AuditLogs · Settings (leaf/cross-cutting)
```

No cycles. `Reports` reads from many modules but is depended on by none — it is the sink.
Anything used by two sibling modules moves down into `common/` rather than sideways.

---

## 4. Next.js application structure

```
apps/web/src/app/
├── layout.tsx                        html shell, fonts, ThemeProvider, Toaster
├── (auth)/                           unauthenticated route group — centered card layout
│   ├── layout.tsx
│   ├── login/page.tsx
│   ├── register/page.tsx
│   ├── forgot-password/page.tsx
│   ├── reset-password/page.tsx
│   └── verify-email/page.tsx
│
├── (app)/                            authenticated route group — sidebar + topbar shell
│   ├── layout.tsx                    AppShell: Sidebar · Topbar · Breadcrumbs · <main>
│   ├── dashboard/page.tsx
│   ├── properties/            page.tsx · [id]/page.tsx (tabs: overview|buildings|units|leases|finance|documents)
│   ├── buildings/             page.tsx · [id]/page.tsx
│   ├── units/                 page.tsx · [id]/page.tsx
│   ├── tenants/               page.tsx · [id]/page.tsx (tabs: profile|lease|rent|payments|maintenance|documents)
│   ├── leases/                page.tsx · [id]/page.tsx
│   ├── rent/                  page.tsx · [id]/page.tsx
│   ├── payments/              page.tsx · [id]/page.tsx
│   ├── receipts/              page.tsx · [id]/page.tsx (print stylesheet)
│   ├── expenses/              page.tsx · [id]/page.tsx
│   ├── maintenance/           page.tsx · [id]/page.tsx
│   ├── staff/page.tsx
│   ├── reports/page.tsx  ·  reports/[report]/page.tsx
│   ├── notifications/page.tsx
│   ├── documents/page.tsx
│   ├── profile/page.tsx
│   └── settings/page.tsx             tabs: organization · users & roles · billing (placeholder) · audit log
│
├── error.tsx · not-found.tsx · loading.tsx
└── providers.tsx                     QueryClientProvider, SessionProvider, Toaster
```

### Feature-slice convention (`src/features/<domain>/`)

```
features/payments/
├── api.ts            typed fetch wrappers over /api/v1/payments
├── queries.ts        usePayments(), usePayment(id) — TanStack Query hooks + query keys
├── mutations.ts      useRecordPayment() with cache invalidation of rent + dashboard keys
├── schemas.ts        Zod: form shape only (required, type, format)
├── columns.tsx       DataTable column defs
└── components/       RecordPaymentDialog, PaymentFilters, PaymentStatusBadge
```

### Shared component layer (`src/components/`)

| Group | Components |
|---|---|
| Shell | `AppShell`, `Sidebar`, `SidebarNav`, `MobileNav` (sheet), `Topbar`, `UserMenu`, `Breadcrumbs`, `OrgSwitcher` (V1: display only) |
| Data | `DataTable` (server-driven sort/filter/paginate), `DataTableToolbar`, `DataTablePagination`, `ColumnVisibility` |
| Feedback | `EmptyState`, `TableSkeleton`, `CardSkeleton`, `ErrorState`, `ConfirmDialog`, toast helpers |
| Display | `StatCard`, `PageHeader`, `StatusBadge`, `Money`, `DateCell`, `PercentDelta` |
| Charts | `RentCollectionChart`, `ExpectedVsCollectedChart`, `ExpenseBreakdownChart`, `NetIncomeChart`, `OccupancyChart`, `PropertyPerformanceChart` (all Recharts, all fed from API) |
| Forms | `FormField` wrappers over RHF + shadcn, `MoneyInput` (string-based), `DatePicker`, `EntityCombobox` (async search) |

### Client rules

1. **All server state through TanStack Query.** No `useEffect` fetching. Query keys are structured
   `['payments', { page, search, filters }]` so mutations invalidate precisely.
2. **`MoneyInput` never uses `number`.** Values stay strings end-to-end; formatting via `Intl.NumberFormat`
   at render only.
3. **Zod on the client validates shape, not policy.** "Is this tenant allowed a lease on this unit"
   is answered by the API, and its 409 is surfaced as a field or form error.
4. **`middleware.ts` is cosmetic.** It redirects when the session cookie is absent, to avoid a
   flash of the app shell. It is not a security boundary; the API is.
5. **Mobile is designed, not shrunk.** Tables collapse into stacked cards below `md`, the sidebar
   becomes a sheet, primary actions become a sticky bottom bar, and the dashboard reflows to one column.

---

## 5. Complete database ERD

```
┌──────────────────┐
│  Organization    │  the tenant boundary — everything below hangs off it
└────────┬─────────┘
         │ 1
    ┌────┴──────────────────────────────────────────────────────────────────┐
    │                                                                       │
    ▼ N                                                                     ▼ N
┌──────────┐  N   ┌──────────────┐  N   ┌────────────┐              ┌──────────────┐
│  User    ├──────┤ UserRole     ├──────┤   Role     │              │  Settings    │ 1:1 org
└────┬─────┘      └──────────────┘      └─────┬──────┘              └──────────────┘
     │                                        │ N
     │ 1                                      ▼
     │                              ┌──────────────────┐  N   ┌────────────┐
     ▼ N                            │ RolePermission   ├──────┤ Permission │
┌──────────────────┐                └──────────────────┘      └────────────┘
│  Session         │
└──────────────────┘
     │ (User) 1                                  ┌───────────────────────┐
     ├──────────────────────────────────────────►│  StaffAssignment      │ N:1 Property
     ├──────────────────────────────────────────►│  AuditLog             │
     ├──────────────────────────────────────────►│  Notification         │
     └──────────────────────────────────────────►│  PasswordResetToken   │
                                                 │  EmailVerification    │
                                                 └───────────────────────┘

┌──────────────┐ 1      N ┌──────────────┐ 1      N ┌──────────────┐
│  Property    ├──────────┤  Building    ├──────────┤    Unit      │
└──────┬───────┘          └──────────────┘          └──────┬───────┘
       │                        ▲                          │
       │                        └── Unit.buildingId (nullable: unit may attach
       │                            directly to a property with no blocks)
       │
       │                    ┌──────────────┐
       │                    │   Tenant     │
       │                    └──────┬───────┘
       │                           │ 1
       │ 1                         │ N
       ▼ N                         ▼
     ┌───────────────────────────────────────────┐
     │                 Lease                     │  → propertyId, buildingId?, unitId, tenantId
     └────────────────────┬──────────────────────┘
                          │ 1
                          ▼ N
                  ┌────────────────┐
                  │  RentRecord    │  one per (lease, period)
                  └───────┬────────┘
                          │ 1
                          ▼ N
                  ┌────────────────┐  1      1  ┌──────────────┐
                  │   Payment      ├────────────┤   Receipt    │  (immutable)
                  └────────────────┘            └──────────────┘

┌──────────────────────┐        ┌──────────────────────┐       ┌──────────────┐
│      Expense         │        │ MaintenanceRequest   │ 1   N │ Maintenance  │
│ property/building/   │        │ property/building/   ├───────┤   Update     │
│ unit (nullable)      │        │ unit/tenant          │       └──────────────┘
└──────────────────────┘        └──────────────────────┘

┌──────────────────────┐   polymorphic soft link (entityType, entityId) to
│      Document        │   Property | Unit | Tenant | Lease | Expense | Maintenance
└──────────────────────┘

┌──────────────────────┐
│   NumberSequence     │  (organizationId, key, year, lastValue) — receipt numbering
└──────────────────────┘
```

### Table inventory (V1)

**Tenancy & identity:** `Organization`, `User`, `Session`, `Role`, `Permission`, `RolePermission`,
`UserRole`, `PasswordResetToken`, `EmailVerificationToken`, `StaffAssignment`, `Settings`
**Portfolio:** `Property`, `Building`, `Unit`
**Occupancy:** `Tenant`, `Lease`
**Money:** `RentRecord`, `Payment`, `Receipt`, `Expense`, `NumberSequence`
**Operations:** `MaintenanceRequest`, `MaintenanceUpdate`, `Document`, `Notification`, `AuditLog`

---

## 6. Complete entity relationships

| Parent | Child | Cardinality | On delete | Rationale |
|---|---|---|---|---|
| Organization | everything org-owned | 1 → N | `Restrict` | An organization is never deleted casually; offboarding is an explicit, audited process |
| Organization | User | 1 → N | `Restrict` | |
| User | Session | 1 → N | `Cascade` | Sessions are disposable |
| User | UserRole | 1 → N | `Cascade` | |
| Role | RolePermission | 1 → N | `Cascade` | Roles are configuration |
| Property | Building | 1 → N | `Restrict` | Deleting a property must not silently orphan blocks |
| Property | Unit | 1 → N | `Restrict` | |
| Building | Unit | 1 → N (optional parent) | `SetNull` | Demolishing a block must not delete rentable history; unit reattaches to the property |
| Property/Unit/Tenant | Lease | 1 → N | `Restrict` | **Financial history is never cascade-deleted** |
| Lease | RentRecord | 1 → N | `Restrict` | |
| RentRecord | Payment | 1 → N (payment optionally unallocated) | `Restrict` | |
| Payment | Receipt | 1 → 1 | `Restrict` | A receipt outlives everything; voiding is a status change, not a delete |
| Property | Expense | 1 → N | `Restrict` | |
| MaintenanceRequest | MaintenanceUpdate | 1 → N | `Cascade` | Updates have no meaning without their request |
| User | StaffAssignment | 1 → N | `Cascade` | |
| Property | StaffAssignment | 1 → N | `Cascade` | |
| User | AuditLog | 1 → N | `Restrict` (nullable actor) | Audit survives user deletion; actor becomes `NULL` + preserved `actorEmail` snapshot |

### Business invariants enforced at the database level

| Invariant | Mechanism |
|---|---|
| One active lease per unit | `CREATE UNIQUE INDEX ... ON "Lease"("unitId") WHERE status = 'ACTIVE'` |
| One rent record per lease per period | `UNIQUE ("leaseId", "periodStart")` |
| Receipt number unique per org | `UNIQUE ("organizationId", "receiptNumber")` |
| One receipt per payment | `UNIQUE ("paymentId")` on `Receipt` |
| Duplicate M-Pesa/bank reference blocked | `UNIQUE ("organizationId", "paymentMethod", "reference") WHERE reference IS NOT NULL` |
| Unit number unique inside its building/property | `UNIQUE ("propertyId", "buildingId", "unitNumber")` (null-safe variant for building-less units) |
| Email unique per organization | `UNIQUE ("organizationId", "email")` on `User` |
| Amounts non-negative | `CHECK (amount > 0)` on `Payment`/`Expense`; `CHECK ("paidAmount" >= 0)` on `RentRecord` |
| Lease dates coherent | `CHECK ("endDate" IS NULL OR "endDate" > "startDate")` |
| Cross-org rows can never join | Composite FKs carrying `organizationId` (e.g. `Unit(organizationId, propertyId) → Property(organizationId, id)`) |

That last row is the strongest structural defence in the design: a `Lease` cannot reference a
`Unit` from another organization even if every guard in the API were bypassed, because the foreign
key includes the tenant column.

### Index plan (beyond primary/unique keys)

Every tenant table: `(organizationId)` plus a compound index on the columns its main list screen
filters and sorts by — e.g.
`Unit(organizationId, status)`, `Unit(organizationId, propertyId, buildingId)`,
`Lease(organizationId, status, endDate)`,
`RentRecord(organizationId, status, dueDate)`, `RentRecord(organizationId, leaseId, periodStart)`,
`Payment(organizationId, paymentDate)`, `Payment(organizationId, tenantId)`,
`Expense(organizationId, expenseDate, category)`,
`MaintenanceRequest(organizationId, status, priority)`,
`AuditLog(organizationId, createdAt)`, `AuditLog(organizationId, entityType, entityId)`,
`Notification(organizationId, userId, readAt)`,
`Session(userId)`, `Session(expiresAt)`.
Free-text search uses `pg_trgm` GIN indexes on `Tenant.fullName`, `Tenant.phone`, `Property.name`,
`Unit.unitNumber` — added in Phase 2 when the search screens land.

---

## 7. Prisma schema design

`prisma/schema.prisma` is the single source of truth. Presented here as a design specification —
the actual file is written in Phase 1.

### Conventions

- `id` — `String @id @default(cuid())`. Opaque, non-enumerable, safe in URLs.
- Money — `Decimal @db.Decimal(14, 2)`. Never `Float`. Serialized as a string.
- Timestamps — `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`. All UTC.
- Dates without time (`expenseDate`, `startDate`) — `@db.Date`.
- Soft delete — only where the spec implies archival (`Property.status = ARCHIVED`, `User.isActive`).
  Financial rows are never soft-deleted; they are voided with an audit trail.
- Every tenant model carries `organizationId String` + relation + `@@index([organizationId])`.

### Enums

```
UserStatus            ACTIVE | INACTIVE | INVITED | SUSPENDED
RoleName              SUPER_ADMIN | PROPERTY_OWNER | PROPERTY_MANAGER | CARETAKER | ACCOUNTANT | TENANT
PropertyType          APARTMENT | RESIDENTIAL | COMMERCIAL | OFFICE | SHOPS | WAREHOUSE | MIXED_USE | OTHER
PropertyStatus        ACTIVE | INACTIVE | ARCHIVED
BuildingStatus        ACTIVE | INACTIVE | ARCHIVED
UnitStatus            VACANT | OCCUPIED | RESERVED | MAINTENANCE | UNAVAILABLE
UnitType              BEDSITTER | STUDIO | ONE_BEDROOM | TWO_BEDROOM | THREE_BEDROOM | SHOP | OFFICE | WAREHOUSE | OTHER
LeaseStatus           ACTIVE | EXPIRING_SOON | EXPIRED | TERMINATED
RentStatus            PENDING | PARTIALLY_PAID | PAID | OVERDUE
PaymentMethod         MPESA | BANK | CASH | CHEQUE | OTHER
PaymentStatus         COMPLETED | VOIDED
ExpenseCategory       MAINTENANCE | REPAIRS | SECURITY | CLEANING | WATER | ELECTRICITY | GARBAGE |
                      SALARIES | INSURANCE | TAXES | MANAGEMENT | CONSTRUCTION | OTHER
MaintenanceStatus     PENDING | ASSIGNED | IN_PROGRESS | COMPLETED | CANCELLED
MaintenancePriority   LOW | MEDIUM | HIGH | URGENT
DocumentEntityType    PROPERTY | BUILDING | UNIT | TENANT | LEASE | EXPENSE | MAINTENANCE | ORGANIZATION
NotificationType      RENT_OVERDUE | RENT_RECORDED | LEASE_EXPIRING | MAINTENANCE_UPDATED |
                      PAYMENT_RECORDED | SYSTEM
```

### Key model field specifications

**Organization** — `id, name, code (unique, used in receipt numbers), email, phone, address, city,
country, currency (default "KES"), timezone (default "Africa/Nairobi"), logoUrl?, status, createdAt, updatedAt`

**User** — `id, organizationId, email, passwordHash, fullName, phone?, avatarUrl?, status,
emailVerifiedAt?, lastLoginAt?, failedLoginCount, lockedUntil?, createdAt, updatedAt`
`@@unique([organizationId, email])`. `passwordHash` is excluded from every serializer by default.

**Session** — `id, userId, organizationId, tokenHash (unique, sha256), csrfSecret, ipAddress?,
userAgent?, expiresAt, lastSeenAt, revokedAt?, createdAt`

**Role / Permission / RolePermission / UserRole** — `Role(id, organizationId?, name: RoleName,
label, description, isSystem)`; `Permission(id, key unique e.g. "payments.create", resource, action,
description)`; join tables with composite unique keys. System roles are seeded with `organizationId = NULL`.

**Property** — `id, organizationId, name, propertyType, description?, addressLine?, city?, county?,
country, latitude? Decimal(9,6), longitude? Decimal(9,6), imageUrl?, status, createdAt, updatedAt`

**Building** — `id, organizationId, propertyId, name, description?, floors Int?, status, createdAt, updatedAt`

**Unit** — `id, organizationId, propertyId, buildingId?, unitNumber, unitType, floor Int?,
bedrooms Int?, bathrooms Int?, monthlyRent Decimal(14,2), securityDeposit Decimal(14,2) default 0,
status, waterMeterNumber?, electricityMeterNumber?, description?, createdAt, updatedAt`

**Tenant** — `id, organizationId, fullName, phone, email?, nationalId?, idType?,
emergencyContactName?, emergencyContactPhone?, occupation?, address?, photoUrl?, notes?,
isActive, createdAt, updatedAt`

**Lease** — `id, organizationId, tenantId, propertyId, buildingId?, unitId, startDate @db.Date,
endDate? @db.Date, monthlyRent Decimal(14,2), securityDeposit Decimal(14,2), depositPaid Decimal(14,2)
default 0, dueDay Int (1–28), status, terminatedAt?, terminationReason?, notes?, createdAt, updatedAt`
> `dueDay` is capped at 28 so no lease can generate an impossible due date in February.

**RentRecord** — `id, organizationId, leaseId, tenantId, propertyId, buildingId?, unitId,
periodStart @db.Date, periodEnd @db.Date, periodLabel ("2026-09"), expectedAmount Decimal(14,2),
paidAmount Decimal(14,2) default 0, balance Decimal(14,2) (stored, always recomputed server-side),
dueDate @db.Date, status, createdAt, updatedAt`
`@@unique([leaseId, periodStart])`
> `balance` is stored for index-able "outstanding" queries but is **derived**: it is only ever written
> by the payment/rent services inside a transaction, and a reconciliation test asserts
> `balance == expectedAmount − paidAmount` and `paidAmount == SUM(allocated payments)` across the whole DB.

**Payment** — `id, organizationId, tenantId, propertyId, buildingId?, unitId, leaseId,
rentRecordId?, amount Decimal(14,2), paymentDate @db.Date, paymentMethod, reference?,
periodLabel?, notes?, status PaymentStatus default COMPLETED, recordedById, voidedById?, voidedAt?,
voidReason?, createdAt`
> Payments are append-only. There is no `updatedAt` because there is no edit path — a mistake is
> corrected by voiding (audited, reverses the rent balance in a transaction) and re-recording.

**Receipt** — `id, organizationId, paymentId (unique), receiptNumber, tenantId, propertyId, unitId,
amount Decimal(14,2), paymentMethod, reference?, paymentDate, periodLabel?, issuedById, createdAt`
`@@unique([organizationId, receiptNumber])`

**Expense** — `id, organizationId, propertyId, buildingId?, unitId?, category, description,
amount Decimal(14,2), expenseDate @db.Date, paymentMethod?, vendor?, reference?, documentId?,
createdById, createdAt, updatedAt`

**MaintenanceRequest** — `id, organizationId, propertyId, buildingId?, unitId?, tenantId?, title,
description, priority, status, assignedToId?, estimatedCost? Decimal(14,2), actualCost? Decimal(14,2),
reportedById, createdAt, updatedAt, completedAt?`
**MaintenanceUpdate** — `id, maintenanceRequestId, organizationId, authorId, note, fromStatus?,
toStatus?, createdAt`

**StaffAssignment** — `id, organizationId, userId, propertyId, assignedById, createdAt`
`@@unique([userId, propertyId])`

**Document** — `id, organizationId, entityType, entityId?, name, originalFilename, storageKey,
mimeType, sizeBytes Int, checksum, uploadedById, createdAt`
> `storageKey` is opaque (`org/{orgId}/{yyyy}/{uuid}`); the original filename is metadata only and is
> never used to build a filesystem path.

**Notification** — `id, organizationId, userId, type, title, body, entityType?, entityId?,
readAt?, createdAt`

**AuditLog** — `id, organizationId, userId?, actorEmail, action, entityType, entityId?,
metadata Json?, ipAddress?, userAgent?, createdAt`

**NumberSequence** — `id, organizationId, key ("RECEIPT"), year Int, lastValue Int` with
`@@unique([organizationId, key, year])`.

**Settings** — `id, organizationId (unique), defaultDueDay, lateFeeEnabled (V1: false),
receiptPrefix, leaseExpiryWarningDays (default 60), rentGenerationEnabled, updatedAt`

### Migration & seed strategy

- Migrations are generated with `prisma migrate dev`, committed, and applied in every other
  environment with `prisma migrate deploy`. Hand-edited SQL is added only for objects Prisma does not
  model (partial unique indexes, `CHECK` constraints, `pg_trgm` indexes, Phase-7 RLS policies) —
  as their own reviewed migration files.
- The seed is **idempotent** and splits in two:
  `permissions.ts` (canonical permissions + system roles — runs in every environment including
  production) and `demo.ts` (two organizations, ~4 properties, ~8 buildings, ~60 units, ~40 tenants,
  leases, 6 months of rent records with a realistic mix of PAID/PARTIAL/OVERDUE, payments, receipts,
  expenses and maintenance — development and test only, guarded by `NODE_ENV`).
- The demo seed deliberately includes a second organization whose data the first must never see;
  the isolation test suite asserts exactly that.

---

## 8. RBAC permission matrix

Permissions are constants of the form `resource.action`. A role holds a set of them; a user holds
roles. The API answers one question per route: *does the caller hold this permission, and is the
target row inside their organization and property scope?*

**Legend:** ✅ full · 🟡 limited to assigned properties (see §9) · 👁 read-only · ❌ denied

| Permission | SUPER_ADMIN | PROPERTY_OWNER | PROPERTY_MANAGER | ACCOUNTANT | CARETAKER | TENANT (V1) |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `properties.view` | ✅ | ✅ | ✅ | 🟡 | 🟡 | ❌ |
| `properties.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `properties.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `properties.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `buildings.view` | ✅ | ✅ | ✅ | 🟡 | 🟡 | ❌ |
| `buildings.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `buildings.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `buildings.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `units.view` | ✅ | ✅ | ✅ | 🟡 | 🟡 | ❌ |
| `units.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `units.update` | ✅ | ✅ | ✅ | ❌ | 🟡 status only | ❌ |
| `units.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `tenants.view` | ✅ | ✅ | ✅ | 🟡 | 🟡 | 👁 self |
| `tenants.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `tenants.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `tenants.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `leases.view` | ✅ | ✅ | ✅ | 🟡 | 🟡 | 👁 self |
| `leases.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `leases.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `leases.terminate` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `rent.view` | ✅ | ✅ | ✅ | 🟡 | ❌ | 👁 self |
| `rent.generate` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `payments.view` | ✅ | ✅ | ✅ | 🟡 | ❌ | 👁 self |
| `payments.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `payments.void` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `receipts.view` | ✅ | ✅ | ✅ | 🟡 | ❌ | 👁 self |
| `expenses.view` | ✅ | ✅ | ✅ | 🟡 | 🟡 own | ❌ |
| `expenses.create` | ✅ | ✅ | ✅ | ✅ | 🟡 | ❌ |
| `expenses.update` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `expenses.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `maintenance.view` | ✅ | ✅ | ✅ | 👁 costs | 🟡 | 👁 self |
| `maintenance.create` | ✅ | ✅ | ✅ | ❌ | 🟡 | ❌ |
| `maintenance.update` | ✅ | ✅ | ✅ | ❌ | 🟡 assigned | ❌ |
| `staff.view` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `staff.create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `staff.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `staff.delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `documents.view` | ✅ | ✅ | ✅ | 🟡 | 🟡 | 👁 self |
| `documents.upload` | ✅ | ✅ | ✅ | ✅ | 🟡 | ❌ |
| `documents.delete` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `reports.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `reports.export` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `notifications.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `settings.view` | ✅ | ✅ | 👁 | ❌ | ❌ | ❌ |
| `settings.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `auditlogs.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `organization.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Rules that sit above the matrix

1. **`SUPER_ADMIN` is platform-level and organization-scoped in V1**: it never reads across
   organizations without an explicit, audited impersonation flow, which V1 does not ship.
2. **No self-escalation.** A user cannot grant a role they do not themselves hold, cannot change
   their own roles, and cannot deactivate themselves.
3. **The last active `PROPERTY_OWNER` cannot be deactivated or demoted.** An organization must always
   have an owner.
4. **A 403 for a scope failure and a 404 for a foreign row.** Asking for another organization's
   property returns `404 Not Found`, not `403 Forbidden` — a 403 would confirm the row exists.
5. **Permissions are checked in the API only.** The frontend receives its permission list from
   `GET /api/v1/auth/me` and uses it purely to hide controls the user cannot use. Hiding a button is
   a courtesy; the guard is the control.

---

## 9. Multi-tenant security model

The single most expensive bug this product could ship is one organization seeing another's money.
Four independent layers guard it.

```
Request
  │
  ├─ L1  Session → organizationId
  │      SessionAuthGuard resolves the org from the session row. The value in the request
  │      body/query/header is IGNORED. DTOs do not even declare an organizationId field, and
  │      ValidationPipe(forbidNonWhitelisted) rejects a request that tries to send one.
  │
  ├─ L2  Prisma client extension
  │      A $extends query hook reads AsyncLocalStorage and injects
  │      { organizationId } into where/create/update/delete for every tenant model.
  │      Bypassing it requires an explicit prisma.$unscoped() call — a grep-able,
  │      review-flagged escape hatch used only by auth and the scheduler.
  │
  ├─ L3  Service-level ownership assertions
  │      Every write that references another row re-fetches it in scope first:
  │      "does this lease's unit belong to my org AND my property scope?"
  │      Composite foreign keys carrying organizationId make a cross-org join
  │      impossible at the database level even if L1–L3 all failed.
  │
  └─ L4  Property scope (staff)
         PropertyScopeGuard resolves scopedPropertyIds:
           OWNER / MANAGER / SUPER_ADMIN → all properties in the org (null = unrestricted)
           ACCOUNTANT / CARETAKER        → StaffAssignment.propertyId list
         Every list query filters by it; every detail fetch asserts membership.
         A staff member with zero assignments sees zero properties — not all of them.
         (Fail closed. The default must never be "no restriction".)
```

**Phase 7 addition — PostgreSQL Row-Level Security.** `ENABLE ROW LEVEL SECURITY` on all tenant
tables with a policy `USING (organization_id = current_setting('app.current_org', true))`, and the
Prisma middleware setting `app.current_org` at the start of each transaction. This is the layer that
protects against a bug in L2, and it is added only after the isolation test suite is green, so a
policy failure is unambiguous.

**Testing the model (mandatory, not optional).** An `org-isolation.e2e-spec.ts` suite seeds two
organizations and, for **every single list and detail endpoint**, asserts that Org A's session gets
`404` on Org B's ids and that Org A's list responses contain zero Org B rows. A new controller
without a row in that suite fails CI via a route-coverage check.

**What is deliberately not trusted, ever:** `organizationId`, `userId`, `role`, `permissions`,
`recordedBy`, `createdBy` from any client-supplied payload. All are derived server-side.

---

## 10. Authentication flow

### Registration (creates organization + owner atomically)

```
POST /api/v1/auth/register { organizationName, fullName, email, password }
  │
  ├─ Throttle (5/hour/IP) · Zod+DTO validation · password policy (min 12 chars, zxcvbn score ≥ 3)
  ├─ $transaction:
  │     1. Organization created (unique code derived from name)
  │     2. User created — passwordHash = argon2id(password, {m:65536, t:3, p:4})
  │     3. UserRole → PROPERTY_OWNER
  │     4. Settings row with defaults
  │     5. EmailVerificationToken (random 32B, only its hash stored)
  │     6. AuditLog: ORGANIZATION_CREATED, USER_REGISTERED
  ├─ EmailProvider.send(verification)   ← V1 adapter logs the link; the flow is real, the transport is not
  └─ 201 + session issued (unverified users may use the app; verification gates nothing in V1
        except a persistent banner — deliberate, so the MVP is usable without an SMTP account)
```

### Login

```
POST /api/v1/auth/login { email, password }
  │
  ├─ Throttle: 5 attempts / 15 min per IP+email; after 10 → User.lockedUntil = now + 15 min
  ├─ Lookup user. If absent → still run a dummy argon2 verify (constant-time; no user enumeration)
  ├─ argon2.verify(hash, password)   → on failure: increment failedLoginCount, audit LOGIN_FAILED,
  │                                     return the SAME generic 401 as an unknown email
  ├─ On success, $transaction:
  │     token   = randomBytes(32) → base64url          (returned to the browser, never stored)
  │     Session { tokenHash: sha256(token), csrfSecret, userId, organizationId,
  │               ip, userAgent, expiresAt: now + 7d }
  │     failedLoginCount = 0 · lastLoginAt = now · AuditLog: LOGIN_SUCCESS
  └─ Set-Cookie:
        pm.sid  = <token>   HttpOnly · Secure(prod) · SameSite=Lax · Path=/ · Max-Age=7d
        pm.csrf = <hmac(csrfSecret, sessionId)>   readable by JS · same attributes minus HttpOnly
     200 { user, organization, roles, permissions }
```

### Authenticated request

```
Browser  ──►  Cookie: pm.sid   +   X-CSRF-Token: <pm.csrf value>  (unsafe methods only)
              │
              ├─ CsrfGuard: constant-time compare header vs cookie vs session.csrfSecret
              ├─ SessionAuthGuard: sha256(cookie) → Session lookup
              │     reject if missing / expired / revoked
              │     sliding expiry: extend lastSeenAt; roll expiresAt if > 24h old (absolute cap 30d)
              ├─ Load User (must be ACTIVE) + roles + permissions (cached in-process, 60s TTL,
              │     invalidated on any role/permission mutation)
              └─ TenantContextInterceptor: ALS.run({ userId, organizationId, permissions, scopedPropertyIds })
```

### Logout / revocation / password lifecycle

| Flow | Behaviour |
|---|---|
| Logout | `Session.revokedAt = now`, cookies cleared with `Max-Age=0`, audited |
| Logout everywhere | Revoke all sessions for the user |
| Change password | Requires current password; on success **revokes all other sessions**, rotates the current one |
| Forgot password | Always returns `202` regardless of whether the email exists. Token: 32 random bytes, sha256-stored, 1-hour TTL, single-use |
| Reset password | Validates token hash + expiry + unused → sets new hash → revokes **all** sessions → audits `PASSWORD_RESET` |
| Verify email | Same token pattern, 24-hour TTL |
| Session sweep | Nightly job deletes sessions expired more than 30 days ago |

### What is explicitly not done

- No JWT. No token in `localStorage` or `sessionStorage`. No token in a URL.
- No password hints, no security questions, no "your password was wrong" vs "no such user".
- Password hashes, `csrfSecret` and `tokenHash` are excluded from every serializer and never logged.

---

## 11. Payment / rent financial flow

### 11.1 Rent record generation (idempotent)

```
Trigger: nightly job (02:00 org timezone) OR manual POST /api/v1/rent/generate
  │
  For each ACTIVE lease in the organization:
    period      = current billing month (periodStart = first of month, periodEnd = last of month)
    dueDate     = periodStart + (lease.dueDay − 1)
    expected    = lease.monthlyRent                      ← Decimal, copied from the lease at generation
    │                                                       time, so a later rent increase never
    │                                                       silently rewrites historical bills
    ├─ skip if lease.startDate > periodEnd  or  lease ended before periodStart
    └─ INSERT ... ON CONFLICT (leaseId, periodStart) DO NOTHING
         → a re-run, a double click, or a container restart mid-job creates nothing new
  Then: RentRecord.status → OVERDUE where dueDate < today AND balance > 0
```

### 11.2 Recording a payment — the transaction that must never half-succeed

```
POST /api/v1/payments  { rentRecordId?, tenantId, leaseId, amount, paymentDate,
                         paymentMethod, reference?, notes? }
  │
  ── Pre-flight (all inside the org + property scope) ────────────────────────
  1. Permission: payments.create
  2. Tenant exists, in org
  3. Lease exists, in org, belongs to that tenant, is ACTIVE or TERMINATED-with-arrears
  4. RentRecord (if supplied) belongs to that lease
  5. amount is a valid Decimal, > 0, ≤ 9,999,999,999.99
  6. paymentDate is not in the future and not before lease.startDate
  7. Duplicate check: (org, method, reference) not already used   → 409 Conflict
  8. Idempotency-Key header, if present, replays the prior response instead of charging twice
  9. amount ≤ rentRecord.balance                                  → 422 if it exceeds
       (V1 rejects overpayment rather than inventing a credit balance — see D10)
  │
  ── $transaction (Serializable-safe; row locked with SELECT ... FOR UPDATE) ──
  10. SELECT rentRecord FOR UPDATE            ← prevents two concurrent payments racing the balance
  11. INSERT Payment (status COMPLETED, recordedById = session user)
  12. rentRecord.paidAmount = paidAmount + amount        (Decimal addition)
      rentRecord.balance    = expectedAmount − paidAmount
      rentRecord.status     = balance == 0        → PAID
                              paidAmount > 0      → PARTIALLY_PAID
                              dueDate < today     → OVERDUE
                              else                → PENDING
  13. receiptNumber = nextSequence(org, 'RECEIPT', year)  ← NumberSequence row locked FOR UPDATE
      INSERT Receipt
  14. INSERT AuditLog { action: PAYMENT_RECORDED, entityId, metadata: {amount, method, receiptNumber} }
  15. INSERT Notification (payment recorded)
  ── COMMIT ──  any failure above → full ROLLBACK: no payment, no receipt, no balance change
  │
  └─ 201 { payment, receipt, rentRecord }   → client invalidates rent, payments,
                                               receipts, tenant, and dashboard query keys
```

### 11.3 Voiding a payment (owner only)

Payments are never edited or deleted. `POST /api/v1/payments/:id/void { reason }` runs the inverse
transaction: mark the payment `VOIDED`, subtract from `rentRecord.paidAmount`, recompute `balance`
and `status`, mark the receipt voided (the number is retained, never reused), write an audit log.
Voiding a payment that was never allocated is a no-op on rent.

### 11.4 The financial rules, stated once and implemented once

```
expected_rent(scope, period)     = Σ RentRecord.expectedAmount
collected_rent(scope, period)    = Σ Payment.amount   WHERE status = COMPLETED
outstanding_rent(scope, period)  = Σ RentRecord.balance   WHERE balance > 0
overdue_rent(scope)              = Σ RentRecord.balance   WHERE balance > 0 AND dueDate < today
total_expenses(scope, period)    = Σ Expense.amount
net_income(scope, period)        = collected_rent − total_expenses      ← CASH basis
collection_rate(scope, period)   = collected_rent / expected_rent × 100  (0 when expected = 0)
occupancy_rate(scope)            = units(OCCUPIED) / units(total excluding ARCHIVED) × 100
```

These live in a single `FinanceCalculationService`. Reports, the dashboard, and tenant profiles all
call it — there is exactly one implementation of "net income" in the codebase.

**Explicitly stated:** net income is **cash basis** (money actually collected minus money actually
spent), not accrual. Both figures are shown on the dashboard so the difference between *billed* and
*banked* is never hidden.

**Rounding:** all money is `Decimal(14,2)`; division (rates, percentages) rounds half-up to 2 dp at
the presentation boundary only. No intermediate rounding.

---

## 12. API route map

Base: `/api/v1`. All routes require an authenticated session except those marked **public**.
All list endpoints accept `?page&limit&search&sortBy&sortOrder` plus their own filters, and return
`{ data: [...], meta: { page, limit, total, totalPages } }`.

### Auth
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/register` | **public** | creates org + owner, throttled |
| POST | `/auth/login` | **public** | throttled, sets cookies |
| POST | `/auth/logout` | session | revokes current session |
| POST | `/auth/logout-all` | session | revokes all sessions |
| GET | `/auth/me` | session | user + org + roles + permissions + scoped property ids |
| POST | `/auth/forgot-password` | **public** | always 202 |
| POST | `/auth/reset-password` | **public** | token + new password |
| POST | `/auth/change-password` | session | requires current password |
| POST | `/auth/verify-email` | **public** | token |
| POST | `/auth/resend-verification` | session | throttled |
| GET | `/auth/sessions` | session | list own active sessions |
| DELETE | `/auth/sessions/:id` | session | revoke one |

### Organization, users, roles, staff, settings
| Method | Path | Permission |
|---|---|---|
| GET / PATCH | `/organization` | `settings.view` / `organization.update` |
| GET | `/settings` · PATCH `/settings` | `settings.view` / `settings.update` |
| GET | `/roles` · GET `/permissions` | `staff.view` |
| GET | `/staff` | `staff.view` |
| POST | `/staff` | `staff.create` (invites a user, assigns role) |
| GET / PATCH | `/staff/:id` | `staff.view` / `staff.update` |
| POST | `/staff/:id/deactivate` · `/staff/:id/activate` | `staff.update` |
| GET | `/staff/:id/properties` | `staff.view` |
| PUT | `/staff/:id/properties` | `staff.update` (replaces the assignment set) |
| DELETE | `/staff/:id` | `staff.delete` |

### Portfolio
| Method | Path | Permission | Filters |
|---|---|---|---|
| GET / POST | `/properties` | `properties.view` / `.create` | `type`, `status`, `city`, `search` |
| GET / PATCH / DELETE | `/properties/:id` | `.view` / `.update` / `.delete` | delete → 409 if in use, suggests archive |
| POST | `/properties/:id/archive` | `properties.update` | |
| GET | `/properties/:id/summary` | `properties.view` | units, occupancy, rent, expenses for that property |
| GET / POST | `/buildings` | `buildings.view` / `.create` | `propertyId`, `status` |
| GET / PATCH / DELETE | `/buildings/:id` | corresponding | |
| GET / POST | `/units` | `units.view` / `.create` | `propertyId`, `buildingId`, `status`, `unitType`, rent range |
| GET / PATCH / DELETE | `/units/:id` | corresponding | |
| PATCH | `/units/:id/status` | `units.update` | manual override limited to MAINTENANCE/UNAVAILABLE |
| GET | `/units/vacant` | `units.view` | convenience feed for the lease form |

### Tenants & leases
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / POST | `/tenants` | `tenants.view` / `.create` | search by name, phone, national id |
| GET / PATCH / DELETE | `/tenants/:id` | corresponding | delete blocked when history exists |
| GET | `/tenants/:id/profile` | `tenants.view` | the 360 view: lease, rent, balance, payments, maintenance, documents |
| GET | `/tenants/:id/ledger` | `payments.view` | chronological expected vs paid |
| GET / POST | `/leases` | `leases.view` / `.create` | `status`, `propertyId`, `tenantId`, expiring-before |
| GET / PATCH | `/leases/:id` | corresponding | |
| POST | `/leases/:id/terminate` | `leases.terminate` | sets status, frees the unit, keeps arrears |
| POST | `/leases/:id/renew` | `leases.update` | new end date + optional new rent |
| GET | `/leases/expiring` | `leases.view` | `?days=60` |

### Rent, payments, receipts
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/rent` | `rent.view` | `period`, `status`, `propertyId`, `tenantId`, `overdueOnly` |
| GET | `/rent/:id` | `rent.view` | includes applied payments |
| GET | `/rent/outstanding` | `rent.view` | the collections worklist |
| GET | `/rent/summary` | `rent.view` | expected / collected / outstanding for a period |
| POST | `/rent/generate` | `rent.generate` | `{ period }`, idempotent, returns created/skipped counts |
| GET / POST | `/payments` | `payments.view` / `.create` | POST honours `Idempotency-Key` |
| GET | `/payments/:id` | `payments.view` | |
| POST | `/payments/:id/void` | `payments.void` | `{ reason }` |
| GET | `/receipts` | `receipts.view` | by number, tenant, date range |
| GET | `/receipts/:id` | `receipts.view` | full print payload |
| GET | `/receipts/:id/pdf` | `receipts.view` | streams a PDF, `Content-Disposition: attachment` |

### Expenses, maintenance
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / POST | `/expenses` | `expenses.view` / `.create` | `category`, `propertyId`, date range |
| GET / PATCH / DELETE | `/expenses/:id` | corresponding | |
| GET | `/expenses/summary` | `expenses.view` | totals by category |
| GET / POST | `/maintenance` | `maintenance.view` / `.create` | `status`, `priority`, `propertyId`, `assignedToId` |
| GET / PATCH | `/maintenance/:id` | corresponding | |
| POST | `/maintenance/:id/assign` | `maintenance.update` | `{ assignedToId }` → status ASSIGNED |
| POST | `/maintenance/:id/status` | `maintenance.update` | validated transition + note |
| POST | `/maintenance/:id/updates` | `maintenance.update` | timeline note |
| GET | `/maintenance/:id/updates` | `maintenance.view` | |

### Documents, notifications, reports, audit
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / POST | `/documents` | `documents.view` / `.upload` | multipart, ≤ 10 MB, allow-listed types |
| GET | `/documents/:id` | `documents.view` | metadata |
| GET | `/documents/:id/download` | `documents.view` | authorized stream; never a public URL |
| DELETE | `/documents/:id` | `documents.delete` | |
| GET | `/notifications` | `notifications.view` | `?unreadOnly` |
| GET | `/notifications/unread-count` | `notifications.view` | topbar badge |
| POST | `/notifications/:id/read` · `/notifications/read-all` | `notifications.view` | |
| GET | `/dashboard/summary` · `/dashboard/charts` | `reports.view` | see §14 |
| GET | `/reports/rent-collection` | `reports.view` | |
| GET | `/reports/outstanding-rent` | `reports.view` | |
| GET | `/reports/tenants` | `reports.view` | |
| GET | `/reports/occupancy` | `reports.view` | |
| GET | `/reports/expenses` | `reports.view` | |
| GET | `/reports/income` | `reports.view` | |
| GET | `/reports/profit-loss` | `reports.view` | |
| GET | `/reports/maintenance` | `reports.view` | |
| GET | `/reports/lease-expiry` | `reports.view` | |
| GET | `/reports/:report/export?format=csv\|pdf` | `reports.export` | |
| GET | `/audit-logs` | `auditlogs.view` | `userId`, `action`, `entityType`, date range |
| GET | `/health/live` · `/health/ready` | **public** | no data, no version leakage |

### Error envelope (identical for every endpoint)

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "DUPLICATE_PAYMENT_REFERENCE",
  "message": "A payment with this reference has already been recorded.",
  "details": [{ "field": "reference", "message": "Already used on receipt RCP-ABC-2026-000117" }],
  "timestamp": "2026-09-09T10:15:00.000Z",
  "path": "/api/v1/payments",
  "requestId": "01J9F2K..."
}
```

`code` is a stable machine-readable string the frontend maps to friendly copy. `details` carries
field-level errors for forms. In production the filter strips stack traces, driver errors and Prisma
error text; the `requestId` correlates to the server log where the real error lives.

**Swagger** is served at `/api/docs` (protected outside development). Every endpoint documents its
request DTO, response entity, required permission, and its possible 400/401/403/404/409/422/429
responses.

---

## 13. Frontend page map

| Route | Purpose | Key components | Required permission |
|---|---|---|---|
| `/login` | Email + password | AuthCard, form | public |
| `/register` | Organization + owner in one form | 2-step form | public |
| `/forgot-password` `/reset-password` `/verify-email` | Password/email lifecycle | AuthCard | public |
| `/dashboard` | Portfolio at a glance | 6 StatCards, 4 charts, overdue list, expiring-lease list | `reports.view` |
| `/properties` | Table + filters (type, status, city) | DataTable, PropertyFormDialog | `properties.view` |
| `/properties/[id]` | Tabs: Overview · Buildings · Units · Leases · Finance · Documents | tabs, StatCards, nested tables | `properties.view` |
| `/buildings` `/buildings/[id]` | Blocks, floors, unit rollup | DataTable, BuildingForm | `buildings.view` |
| `/units` | Unit grid/table, status colour coding | DataTable + card grid toggle | `units.view` |
| `/units/[id]` | Unit detail: current lease, rent history, maintenance | tabs | `units.view` |
| `/tenants` | Search-first table | DataTable, TenantFormDialog | `tenants.view` |
| `/tenants/[id]` | **Tenant 360**: profile, unit, lease, balance, payment history, maintenance, documents, lease history | tabs, ledger table, `RecordPaymentDialog` | `tenants.view` |
| `/leases` | Status filters, expiring highlight | DataTable, LeaseWizard | `leases.view` |
| `/leases/[id]` | Terms, deposit, rent schedule, terminate/renew | detail + ConfirmDialog | `leases.view` |
| `/rent` | Rent roll by period; PENDING/PARTIAL/PAID/OVERDUE tabs; "Generate period" action | DataTable, PeriodPicker | `rent.view` |
| `/rent/[id]` | One rent record + applied payments + "Record payment" | detail | `rent.view` |
| `/payments` | All payments, method/date/property filters | DataTable | `payments.view` |
| `/payments/[id]` | Payment detail + linked receipt + void (owner) | detail | `payments.view` |
| `/receipts` | Receipt register, search by number | DataTable | `receipts.view` |
| `/receipts/[id]` | Print-optimised receipt (`@media print`), download PDF | ReceiptView | `receipts.view` |
| `/expenses` | Category/date/property filters, totals row | DataTable, ExpenseFormDialog | `expenses.view` |
| `/expenses/[id]` | Detail + attachment | detail | `expenses.view` |
| `/maintenance` | Board-style status columns + table toggle | Tabs, MaintenanceForm | `maintenance.view` |
| `/maintenance/[id]` | Timeline of updates, assign, status, costs | timeline | `maintenance.view` |
| `/staff` | Staff list, roles, property assignments, activate/deactivate | DataTable, StaffForm, PropertyAssignmentDialog | `staff.view` |
| `/reports` | Report launcher grid → `/reports/[report]` with filters + export | ReportRunner, chart + table | `reports.view` |
| `/notifications` | Full list, mark read/all | list | authenticated |
| `/documents` | All documents, filter by entity type, upload | DataTable, Dropzone | `documents.view` |
| `/profile` | Own details, change password, active sessions | forms | authenticated |
| `/settings` | Tabs: Organization · Users & Roles · Preferences · Audit Log | tabs | `settings.view` |

**Universal page states.** Every list page ships four states before it is considered done:
loading (skeleton matching the final layout, not a spinner), empty (illustration + one-sentence
explanation + primary action), error (message + retry), and populated. Every destructive action is
behind a `ConfirmDialog` that names the record. Every mutation raises a toast.

**Navigation.** Sidebar groups: *Overview* (Dashboard) · *Portfolio* (Properties, Buildings, Units) ·
*Occupancy* (Tenants, Leases) · *Finance* (Rent, Payments, Receipts, Expenses) · *Operations*
(Maintenance, Staff, Documents) · *Insights* (Reports) · *System* (Settings). Items the user lacks
permission for are not rendered.

---

## 14. Dashboard structure

```
GET /api/v1/dashboard/summary?period=2026-09&propertyId=<optional>
GET /api/v1/dashboard/charts?months=12&propertyId=<optional>
```

Two endpoints, both scoped by organization and property scope, both computed with SQL aggregates on
Decimal columns. **No number on this screen is computed in the browser and none is hardcoded.**

### Stat cards (row 1)

| Card | Source |
|---|---|
| Total properties / buildings / units | counts excluding `ARCHIVED` |
| Occupied vs vacant units | `Unit.status` counts |
| **Occupancy rate** | occupied ÷ total × 100, with delta vs previous month |
| **Expected rent (this period)** | Σ `RentRecord.expectedAmount` |
| **Collected rent (this period)** | Σ completed `Payment.amount` |
| **Outstanding rent** | Σ `RentRecord.balance > 0`, with the overdue portion called out in red |
| **Total expenses (this period)** | Σ `Expense.amount` |
| **Net income (cash basis)** | collected − expenses |

### Charts (Recharts)

| Chart | Type | Data |
|---|---|---|
| Rent collection over time | Line/area, 12 months | collected per month |
| Expected vs collected | Grouped bar, 12 months | two Decimal series |
| Expenses by category | Donut + legend table | Σ per `ExpenseCategory` |
| Net income trend | Bar with zero baseline | collected − expenses per month |
| Occupancy trend | Line, 12 months | occupied ÷ total per month |
| Property performance | Horizontal bar, top N | collected rent per property, expenses overlaid |

### Worklists (row 3)

- **Overdue rent** — top 10 by balance, each row linking straight to *record payment*.
- **Leases expiring in 60 days** — tenant, unit, end date, days remaining.
- **Open maintenance** — grouped by priority, `URGENT` first.
- **Recent payments** — last 10, with receipt links.

### Performance

The summary endpoint targets < 300 ms on a 10,000-unit organization. It runs as a small set of
grouped aggregate queries (not per-property N+1), and is cached per `(orgId, period, propertyScope)`
for 60 seconds in-process, invalidated immediately by any payment, expense, lease or unit mutation.
Chart series come from a single `date_trunc('month', ...) GROUP BY` per series.

**Scope behaviour:** an `ACCOUNTANT` or `CARETAKER` sees the same dashboard computed over their
assigned properties only. A staff member with no assignments sees zeros and an explanatory empty
state — never the whole organization.

---

## 15. Reporting architecture

```
Controller (filters DTO)
   │  validated: dateFrom/dateTo, propertyId, buildingId, unitId, tenantId,
   │             status, category, paymentMethod, groupBy, page/limit
   ▼
ReportsService                 ← chooses the report strategy
   ▼
<Report>Strategy               ← one class per report, implementing a common interface
   │      buildQuery() → runs Prisma aggregate / groupBy / raw SQL for heavy rollups
   │      toRows()     → normalised { columns[], rows[], totals{}, meta{} }
   ▼
FinanceCalculationService      ← the ONLY place money formulas live (§11.4)
   ▼
Exporter (CSV | PDF)           ← same rows object, different renderer
```

### The nine V1 reports

| Report | Grain | Columns | Totals |
|---|---|---|---|
| Rent Collection | payment | date, tenant, property, unit, period, method, reference, amount | count, sum |
| Outstanding Rent | rent record with balance > 0 | tenant, unit, period, expected, paid, balance, days overdue | sum expected/paid/balance |
| Tenant | tenant | name, contact, unit, lease dates, rent, balance, status | count, total balance |
| Occupancy | property/building | total units, occupied, vacant, maintenance, occupancy % | portfolio rate |
| Expense | expense | date, property, category, description, amount, method | sum, sum per category |
| Income | period | expected, collected, collection rate | sums |
| Profit & Loss | period × property | collected income, expenses by category, net | net total |
| Maintenance | request | date, property, unit, title, priority, status, assignee, estimated, actual | counts by status, cost sums |
| Lease Expiration | lease | tenant, unit, start, end, days remaining, rent, status | count |

### Rules

1. **Every report reads the live database.** No materialised snapshots, no cached report tables in V1.
2. **Every report is organization- and property-scope filtered** by the same guards as the rest of the
   API — a report is not a back door.
3. **Aggregation happens in PostgreSQL**, not in Node loops, and never in the browser.
4. **Every report screen shows its filter set in its header and in its export**, so a printed report
   states exactly what it covers.
5. **CSV** is generated by streaming (no full-array buffering); **PDF** is rendered server-side from
   the same rows object so screen and paper cannot disagree.
6. **Empty is a valid result**, rendered as an explicit "no records match these filters" state — never
   a blank table or a zero that looks like data.

---

## 16. Document architecture

```
Upload:  multipart → Multer(memory, 10 MB cap) → validation chain → FileStorageProvider.put()
                                                                  → Document row (metadata)
Download: GET /documents/:id/download
          → session → permission → org ownership → (scope check on the linked entity)
          → FileStorageProvider.get(storageKey) → streamed with a safe filename
```

### Validation chain (all must pass; fail closed)

1. Size ≤ 10 MB (configurable per environment).
2. Extension in the allow-list: `pdf, jpg, jpeg, png, webp, doc, docx, xls, xlsx`.
3. Declared MIME type in the allow-list **and** consistent with the extension.
4. **Magic-byte sniffing** of the real buffer — a `.pdf` that starts with `<?php` or `<script` is rejected.
5. Filename sanitised for display; the **stored path is generated, never user-supplied**:
   `org/{organizationId}/{yyyy}/{mm}/{uuid}{ext}`.
6. SHA-256 checksum stored, so a corrupted or swapped object is detectable.
7. Linked entity (`entityType` + `entityId`) is verified to exist inside the caller's organization.

### Storage provider port

```ts
interface FileStorageProvider {
  put(key: string, buffer: Buffer, mimeType: string): Promise<{ key: string; size: number }>;
  get(key: string): Promise<NodeJS.ReadableStream>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUrl?(key: string, ttlSeconds: number): Promise<string>;  // S3 adapter only
}
```

- **V1 dev/prod-small:** `LocalFileStorageProvider` writing under `STORAGE_LOCAL_PATH`, a Docker
  volume. The directory is **outside the web root** and is never statically served.
- **Later:** `S3FileStorageProvider` (S3/R2/Spaces). Switching is an environment variable
  (`STORAGE_DRIVER`) plus a DI binding — no domain code changes.
- **Never:** file bytes in PostgreSQL, or a guessable public URL. Even with S3, objects stay private
  and are reached through a short-TTL signed URL issued only after the same authorization checks.

### Security properties

- No path traversal is possible: user input never contributes to the storage key.
- Downloads always send `Content-Disposition: attachment` and
  `X-Content-Type-Options: nosniff`, so an uploaded HTML/SVG file can never execute in the app origin.
- Delete removes the row and the object in that order, inside a transaction with a compensating
  cleanup job for orphaned objects.
- Every upload, download and delete writes an `AuditLog` entry.

---

## 17. Notification architecture

V1 is in-app only, but the seam for SMS/Email/WhatsApp is cut now so V2 is an adapter, not a rewrite.

```
Domain event  (payment.recorded, maintenance.updated, lease.terminated …)
      │                                     Scheduled jobs
      │                                       ├─ rent overdue sweep      (daily 06:00)
      │                                       ├─ lease expiring          (daily 06:15, 60/30/7 days)
      │                                       └─ maintenance stale       (daily 06:30, URGENT > 48h)
      ▼                                       ▼
              ┌───────────────────────────────────────┐
              │        NotificationService            │
              │  build(type, recipients, payload)     │
              │  dedupe(orgId, type, entityId, day)   │  ← one alert per thing per day
              └───────────────┬───────────────────────┘
                              │
             ┌────────────────┼──────────────────────────────┐
             ▼                ▼                              ▼
      InAppChannel      EmailProvider (port)        SmsProvider / WhatsAppProvider (ports)
      Notification row  V1: ConsoleEmailAdapter     V1: NoopAdapter — registered, never enabled
      (implemented)     (logs, does not send)       (V2/V3 adapters slot in behind the same interface)
```

**Recipient resolution** respects the permission matrix and property scope: a rent-overdue alert goes
to owners, managers, and accountants assigned to that property — not to every user in the
organization, and never to a caretaker who cannot see money.

**Delivery to the browser:** polling. `GET /notifications/unread-count` every 60 seconds via TanStack
Query, refetched on window focus. No WebSockets in V1 — the value does not justify the operational
cost yet, and the polling contract can be swapped for SSE later without touching the API surface.

**Notification types shipped in V1:** `RENT_OVERDUE`, `PAYMENT_RECORDED`, `LEASE_EXPIRING`,
`MAINTENANCE_UPDATED`, `SYSTEM`.

**Deliberately excluded (spec §23/§43):** SMS automation, WhatsApp automation, email campaigns.
The provider interfaces exist and are dependency-injected; their V1 implementations are no-ops that
log. Nothing is presented in the UI as if it sends a message when it does not.

---

## 18. Testing strategy

```
                 ▲   Playwright (tests/e2e)         ~15 specs
                /│\  full workflows, real DB, both viewports
               /─┼─\
              /  │  \ Supertest (apps/api/test)      ~60 specs
             /   │   \ HTTP-level: auth, permissions, isolation, money
            /────┼────\
           /     │     \ Jest + Vitest units       ~200 specs
          /______│______\ services, calculators, guards, hooks, components
```

### Backend — Jest (unit) + Supertest (integration/e2e)

Runs against a **real PostgreSQL** in Docker (`pm_test` database), migrated and truncated between
specs. No mocked Prisma for integration tests — mocked databases hide exactly the constraint
violations we are relying on.

Mandatory suites:

| Suite | Asserts |
|---|---|
| `auth.e2e` | register, login, wrong password is indistinguishable from unknown email, lockout after N attempts, session revocation, password reset invalidates all sessions, CSRF rejection |
| `org-isolation.e2e` | **for every endpoint**: Org A cannot read, list, update or delete Org B's rows; Org A's lists contain no Org B rows. Route-coverage check fails CI on an uncovered controller |
| `permissions.e2e` | every role × every endpoint, from the §8 matrix, table-driven |
| `property-scope.e2e` | caretaker/accountant see only assigned properties; zero assignments → zero rows |
| `properties/buildings/units/tenants.e2e` | CRUD, validation, delete-blocking when history exists |
| `leases.e2e` | no second ACTIVE lease on a unit (including a concurrent-request race), date coherence, termination frees the unit |
| `rent.e2e` | generation is idempotent under repeat and concurrency; status derivation across all four states; no record for an unstarted lease |
| `payments.e2e` | **the critical suite**: correct balance after partial/full payment; overpayment rejected; duplicate reference rejected; `Idempotency-Key` replay creates one payment; concurrent payments on one rent record do not double-credit; a forced failure at receipt creation rolls back the payment; void reverses the balance exactly |
| `finance-calculation.spec` | Decimal arithmetic including the classic float traps (0.1+0.2, 1/3 splits), rounding policy, division by zero |
| `receipts.e2e` | number uniqueness per org, gapless sequence under concurrency, immutability |
| `documents.e2e` | oversized rejected, disguised extension rejected via magic bytes, cross-org download → 404, path traversal attempt neutralised |
| `reports.e2e` | figures reconcile against directly-seeded values; scope respected |
| `audit.e2e` | mutations write logs; no password/token/secret ever appears in a log row |

### Frontend — Vitest + Testing Library

Money formatting, form validation schemas, permission-driven rendering, table filter/pagination state,
chart data adapters, and the API client's error mapping.

### End-to-end — Playwright

`chromium` desktop + `Mobile Chrome` viewport, both run in CI:

1. Register → create org → land on an empty dashboard.
2. Property → building → units with rent set.
3. Tenant → lease → unit becomes `OCCUPIED`.
4. Generate rent → record a partial payment → balance and status correct → receipt renders and prints.
5. Record the balance → status `PAID`.
6. Expense → dashboard net income moves by exactly that amount.
7. Maintenance: create → assign → in progress → complete with actual cost.
8. Staff: create caretaker, assign one property, log in as them, confirm the other property is invisible.
9. Reports: run each, apply filters, export CSV.
10. Unauthorized access: caretaker navigating directly to `/staff` is blocked by the API, not just the UI.

### Definition of done and CI gate

A module is not complete until its unit tests, its isolation row, and its permission row exist and
pass. CI runs, in order: `typecheck → lint → unit → integration (with Postgres service) → build →
e2e`. A red pipeline blocks merge. Coverage floors: 85 % on `modules/**/*.service.ts` and 100 % on
`common/money/**` and `FinanceCalculationService`.

---

## 19. Docker architecture

### Development — `docker-compose.yml`

```
┌──────────────────────────────────────────────────────────────────┐
│  postgres        postgres:16-alpine                              │
│                  :5432 → pgdata volume, healthcheck pg_isready   │
│                  POSTGRES_DB=property_management                 │
│                                                                  │
│  api             node:20-alpine (dev target, hot reload)         │
│                  :3001 → depends_on postgres(service_healthy)    │
│                  entrypoint: prisma migrate deploy && start:dev  │
│                  volumes: ./ (bind) + node_modules (anonymous)   │
│                  volumes: storage_uploads → /app/storage         │
│                                                                  │
│  web             node:20-alpine (dev target, hot reload)         │
│                  :3000 → depends_on api                          │
│                  NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1│
└──────────────────────────────────────────────────────────────────┘
```

Three services. Nothing else — no Redis, no queue, no proxy, no search cluster. The spec is explicit
that infrastructure is added only when a requirement demands it.

An optional `--profile test` adds a `postgres_test` service on `:5433` for the integration suite, so
tests never truncate the development database.

### Production — `docker-compose.prod.yml`

Multi-stage builds, distroless-style runtime:

```
Stage 1 deps     pnpm fetch --frozen-lockfile           (cached layer)
Stage 2 build    prisma generate → nest build / next build
Stage 3 runner   node:20-alpine, non-root user (uid 1001), production deps only,
                 HEALTHCHECK → /health/ready, dumb-init as PID 1
```

Production compose adds an `nginx`/Caddy service terminating TLS and routing `/` → web,
`/api` → api, with the API not published directly to the host. Migrations run as a **one-shot
`migrate` service** that must exit 0 before `api` starts — never automatically inside the app
process, so a bad migration cannot be silently retried by a restarting container.

Images carry no secrets; every secret arrives as an environment variable at runtime.
`.dockerignore` excludes `node_modules`, `.env*`, `.git`, `storage`, and test output.

---

## 20. Environment variables

`.env.example` is committed with safe placeholders; `.env` is git-ignored. The API validates the
whole environment with a Zod schema **at boot and fails fast** — a missing `SESSION_SECRET` stops the
process, it does not fall back to a default.

| Variable | Scope | Example / default | Notes |
|---|---|---|---|
| `NODE_ENV` | both | `development` \| `test` \| `production` | |
| `DATABASE_URL` | api | `postgresql://pm:pm@postgres:5432/property_management?schema=public` | |
| `TEST_DATABASE_URL` | api | `postgresql://pm:pm@localhost:5433/pm_test` | integration suite |
| `API_PORT` | api | `3001` | |
| `API_URL` | api | `http://localhost:3001` | absolute links in emails |
| `APP_URL` | both | `http://localhost:3000` | reset/verify links |
| `CORS_ORIGIN` | api | `http://localhost:3000` | comma-separated allow-list; **never `*` with credentials** |
| `SESSION_SECRET` | api | 64-byte random | required, ≥ 32 chars enforced |
| `SESSION_TTL_DAYS` | api | `7` | |
| `SESSION_ABSOLUTE_TTL_DAYS` | api | `30` | sliding-expiry ceiling |
| `COOKIE_DOMAIN` | api | empty in dev, `.example.com` in prod | |
| `COOKIE_SECURE` | api | `false` dev / `true` prod | |
| `ARGON2_MEMORY_COST` / `_TIME_COST` / `_PARALLELISM` | api | `65536` / `3` / `4` | tunable per host |
| `RATE_LIMIT_TTL` / `RATE_LIMIT_LIMIT` | api | `60` / `120` | global bucket; auth routes are stricter |
| `STORAGE_DRIVER` | api | `local` \| `s3` | |
| `STORAGE_LOCAL_PATH` | api | `./storage/uploads` | |
| `MAX_UPLOAD_SIZE_MB` | api | `10` | |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | api | — | required only when `STORAGE_DRIVER=s3` |
| `EMAIL_DRIVER` | api | `console` (V1) \| `smtp` | |
| `SMTP_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `EMAIL_FROM` | api | — | V2 |
| `SWAGGER_ENABLED` | api | `true` dev / `false` prod | |
| `LOG_LEVEL` | api | `debug` dev / `info` prod | |
| `DEFAULT_CURRENCY` / `DEFAULT_TIMEZONE` | api | `KES` / `Africa/Nairobi` | org-level default at signup |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:3001/api/v1` | the only public variable; contains no secret |

**Rules:** no secret is ever hardcoded, committed, logged, or returned by an endpoint. Secrets are
rotated by replacing the environment value and restarting; rotating `SESSION_SECRET` invalidates all
sessions by design. Any variable prefixed `NEXT_PUBLIC_` is treated as world-readable.

---

## 21. Development phases

Each phase ends with a working, migrated, tested application — never a half-wired layer. After each
phase I stop and wait for your approval.

| Phase | Delivers | Migrations | Tests added | Demo-able outcome |
|---|---|---|---|---|
| **1 — Foundation** | pnpm workspace, Next.js + NestJS skeletons, Docker Compose, env validation, Prisma bootstrap, Organization/User/Session/Role/Permission, Argon2id auth, CSRF, guards, tenant context, permission seed, app shell (sidebar, topbar, breadcrumbs, theme, toasts) | `init` (identity + tenancy) | auth e2e, permission guard units, first isolation specs | Register → log in → see an empty, authenticated dashboard shell |
| **2 — Property management** | Properties, Buildings, Units + full CRUD, statuses, server-side search/filter/sort/pagination, DataTable, empty/loading/error states | `portfolio` | CRUD + isolation + scope specs | Build a real portfolio and browse it |
| **3 — Tenants & leases** | Tenants, tenant 360 profile, Leases, deposits, unit assignment, one-active-lease invariant, expiry tracking | `occupancy` | lease invariant + concurrency specs | Move a tenant into a unit; unit turns `OCCUPIED` |
| **4 — Financial** | RentRecord generation, balances, Payments (transactional), Receipts + numbering + print, Expenses, `FinanceCalculationService` | `finance` | the payments/rent/receipt suites — the heaviest testing in the project | Bill, collect, receipt, and see a true balance |
| **5 — Operations** | Maintenance + updates, Staff + assignments, Documents (upload/authorized download), Notifications, Audit logs | `operations` | document security, staff scope, audit specs | Run the day-to-day, with a real audit trail |
| **6 — Dashboard & reports** | Dashboard summary/charts endpoints, 6 Recharts visuals, worklists, all 9 reports + filters + CSV/PDF export | index-only | reconciliation specs (reports vs seeded truth) | Managers get their numbers |
| **7 — Security & hardening** | Full security/authorization/isolation audit, optional Postgres RLS, rate-limit tuning, error-handling sweep, performance pass on the dashboard, responsive + accessibility pass (keyboard, focus, contrast, labels) | `rls` (optional) | penetration-style specs, axe checks, load check | Ready to hand to a paying customer |
| **8 — V1 release** | Production Dockerfiles + compose, migrate/seed runbook, README, Swagger, deployment doc, backup + restore drill, logging/monitoring strategy | — | full suite green in CI | Deployable, documented, restorable |

Per the spec's development rules, each phase begins with: what will be built, the architecture
involved, the database changes, the security considerations, and the file list — then the code, then
an explanation of every major file, install/run/migrate/seed/test commands, known issues, and a
requirement-by-requirement verification.

---

## 22. Version 1 scope verification

Every numbered item from spec §8 mapped to where it is built. Nothing in the list is unassigned.

| # | Workflow requirement | Phase | Delivered by |
|---|---|---|---|
| 1 | Register | 1 | `POST /auth/register`, `/register` |
| 2 | Login | 1 | `POST /auth/login`, `/login` |
| 3 | Create organization | 1 | atomic with registration |
| 4 | Create property | 2 | PropertiesModule, `/properties` |
| 5 | Create buildings | 2 | BuildingsModule |
| 6 | Create units | 2 | UnitsModule |
| 7 | Set monthly rent | 2 | `Unit.monthlyRent` (Decimal) |
| 8 | Add tenants | 3 | TenantsModule |
| 9 | Assign tenants to units | 3 | Lease creation → unit `OCCUPIED` |
| 10 | Create leases | 3 | LeasesModule + wizard |
| 11 | Generate/track monthly rent | 4 | RentModule generator + `/rent` |
| 12 | Record payments | 4 | `POST /payments` transaction |
| 13 | Calculate balances | 4 | `FinanceCalculationService` |
| 14 | Generate receipts | 4 | ReceiptsModule, print view + PDF |
| 15 | Record expenses | 4 | ExpensesModule |
| 16 | Create maintenance requests | 5 | MaintenanceModule |
| 17 | Assign maintenance | 5 | `POST /maintenance/:id/assign` |
| 18 | Update maintenance status | 5 | transition-validated endpoint |
| 19 | View occupancy | 6 | dashboard + occupancy report |
| 20 | View rent collection | 6 | dashboard chart + report |
| 21 | View outstanding rent | 6 | `/rent/outstanding` + report |
| 22 | View income | 6 | income report |
| 23 | View expenses | 6 | expense report |
| 24 | View basic profit/loss | 6 | P&L report (cash basis) |
| 25 | Generate reports | 6 | all 9 reports + export |
| 26 | Manage staff | 5 | StaffModule + assignments |
| 27 | Upload documents | 5 | DocumentsModule |
| 28 | View notifications | 5 | NotificationsModule |
| 29 | View audit logs where authorized | 5 | AuditLogsModule, owner-only |
| 30 | Logout securely | 1 | session revocation + cookie clear |

### Exclusions honoured (spec §43)

M-Pesa API, automatic reconciliation, SMS/WhatsApp/email automation, tenant portal, mobile apps,
online payment gateways, SaaS billing, AI features, e-signatures, tenant screening, rental
applications, public marketplace, accounting/bank integrations, utility/meter integrations,
multi-country tax, microservices, Kubernetes. **`MPESA` appears only as a manually-selected payment
method with a typed reference** — no integration, and the UI never implies one exists.

### Honest gaps in V1 (stated, not hidden)

- **Email is not actually sent.** The `EmailProvider` port and both flows (verification, password
  reset) are fully implemented; the V1 adapter logs the link instead of delivering it. Verification
  therefore gates nothing except a banner. Supplying SMTP credentials in V2 makes it live with no
  domain-code change.
- **PDF export** covers receipts and reports via a server-side renderer; it is not a
  pixel-designed template system.
- **No pro-rata rent, late fees, credit balances, or deposit refund ledger** — see open questions Q2/Q3.
- **`TENANT` and `SUPER_ADMIN` have no login surface.** They exist in the schema and matrix only.

---

## 23. Security checklist

Every line below is verified by a test, a guard, or a documented configuration before V1 ships.

**Authentication**
- [ ] Argon2id (m=64 MiB, t=3, p=4), never MD5/SHA/bcrypt-with-low-cost
- [ ] Password policy: ≥ 12 chars, strength-scored, checked against a common-password list
- [ ] Opaque session token; only its SHA-256 hash is stored
- [ ] Cookies `HttpOnly`, `Secure` (prod), `SameSite=Lax`, `Path=/`, explicit `Max-Age`
- [ ] No token in `localStorage`, `sessionStorage`, or any URL
- [ ] Login throttled per IP+email; account lockout with automatic expiry
- [ ] Timing-safe failure path; identical response for unknown email and wrong password
- [ ] Session revocation on logout, password change, and password reset (all sessions)
- [ ] Sliding expiry with an absolute ceiling

**Authorization**
- [ ] Every non-public route carries an explicit `@RequirePermissions`; a missing decorator **denies** by default
- [ ] Permission matrix (§8) enforced server-side and covered by a table-driven test per role
- [ ] Property scope enforced on every list and detail read for scoped roles; empty scope → empty result
- [ ] No self-escalation; last owner protected
- [ ] Foreign rows return `404`, not `403`

**Multi-tenancy**
- [ ] `organizationId` always from the session, never from the payload
- [ ] Prisma tenant extension applied to every tenant model
- [ ] Composite foreign keys carrying `organizationId` on every cross-entity relation
- [ ] Isolation e2e coverage for **every** endpoint, enforced by a route-coverage check in CI
- [ ] (Phase 7) Postgres RLS enabled with `app.current_org`

**Input & output**
- [ ] Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` + `transform`
- [ ] DTOs on every body, query and param; no `any` on a request boundary
- [ ] Prisma parameterises all queries; raw SQL only via tagged templates
- [ ] Responses serialized through entity classes — `passwordHash`, `tokenHash`, `csrfSecret` are never serializable
- [ ] React escapes by default; no `dangerouslySetInnerHTML` anywhere

**Transport & headers**
- [ ] Helmet: HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, Referrer-Policy, CSP on the web app
- [ ] CORS allow-list with `credentials: true`; wildcard origin impossible
- [ ] HTTPS enforced in production; cookies never sent over HTTP

**CSRF**
- [ ] Signed double-submit token on every unsafe method, bound to the session
- [ ] Constant-time comparison; rejection is `403` with a stable error code

**Rate limiting**
- [ ] Global bucket + strict buckets on login, register, forgot-password, and upload
- [ ] `429` with `Retry-After`

**Financial integrity**
- [ ] Decimal end-to-end; no `Number` on an authoritative money path (lint rule + review)
- [ ] Every multi-row money operation inside `$transaction` with row locks
- [ ] Duplicate reference, duplicate rent period, and duplicate receipt number blocked by DB constraints
- [ ] Idempotency key honoured on payment creation
- [ ] No negative balances; overpayment rejected
- [ ] Payments append-only; correction is a void, never a delete
- [ ] Reconciliation test: `Σ payments == Σ rentRecord.paidAmount` across the seeded database

**Files**
- [ ] Size, extension, MIME and magic-byte validation; generated storage keys; no traversal
- [ ] Private storage; authorized streaming download only; `nosniff` + `attachment`

**Audit & logging**
- [ ] All sensitive mutations audited with actor, entity, IP, timestamp
- [ ] Structured logs with a request id; **no passwords, tokens, cookies, or secrets in logs**
- [ ] Audit table is insert-only; audit failure never breaks the user's request

**Errors & secrets**
- [ ] Uniform error envelope; stack traces and driver errors stripped in production
- [ ] Secrets only from validated environment variables; boot fails when one is missing
- [ ] `.env` git-ignored; `.env.example` carries placeholders only
- [ ] `pnpm audit` + Dependabot in CI

---

## 24. Deployment architecture

### Target for V1 (deliberately modest)

```
                    Internet
                        │  HTTPS (Let's Encrypt, auto-renewed)
                        ▼
        ┌───────────────────────────────────┐
        │  Reverse proxy — Caddy or Nginx   │
        │  TLS termination · HSTS · gzip    │
        │  /      → web:3000                │
        │  /api   → api:3001                │
        └───────────────┬───────────────────┘
                        │  private Docker network
        ┌───────────────┴──────────────┬──────────────────────┐
        ▼                              ▼                      ▼
   web (Next.js)                 api (NestJS)          postgres:16
   node:20-alpine                node:20-alpine        managed service
   non-root                      non-root              or container + volume
                                      │
                                      ▼
                                 storage volume  →  S3-compatible bucket
```

A single VPS (2 vCPU / 4 GB) running Docker Compose comfortably serves the first cohort of
customers. The architecture is not coupled to it: because the API is stateless apart from cookies
(sessions live in Postgres, not memory), scaling out is adding replicas behind the same proxy — no
sticky sessions, no code change.

### Release process

```
git push → CI: typecheck → lint → unit → integration(+Postgres) → build images → e2e
         → push images to registry, tagged by commit SHA
         → deploy:  docker compose pull
                    docker compose run --rm migrate     # prisma migrate deploy, must exit 0
                    docker compose up -d api web        # rolling, healthcheck-gated
                    smoke test /health/ready + a login
         → roll back = redeploy the previous SHA (migrations are written forward-compatible:
           additive first, destructive changes only one release after the code stops using the column)
```

### Backups and recovery

- `pg_dump` nightly + WAL archiving where the host supports it; 30-day retention, encrypted at rest,
  stored off-host.
- File storage: bucket versioning (S3) or a nightly volume snapshot (local driver).
- **A restore drill is part of the Phase 8 checklist** — an untested backup is not a backup.
- Documented RPO 24 h / RTO 4 h for V1, tightened when customer count justifies it.

### Observability

- Structured JSON logs (pino) with a request id, shipped to the host's log driver.
- `/health/live` and `/health/ready` for the orchestrator and uptime monitoring.
- Error tracking (Sentry or equivalent) with PII scrubbing — never send request bodies containing
  personal data or money references.
- Slow-query logging on Postgres; a weekly index review during the first months.

---

## 25. Future scalability strategy

The modular monolith is the destination for V1, not a stepping stone we are embarrassed about. What
matters is that the seams are already cut where a future split would happen.

**Seams already in place**
1. Module boundaries with no cyclic dependencies (§3), each owning its own repository layer — no
   module reaches into another's tables directly.
2. Provider ports (`FileStorageProvider`, `EmailProvider`, `SmsProvider`, `WhatsAppProvider`,
   `PaymentGatewayProvider`) so external systems are adapters, never entangled dependencies.
3. `FinanceCalculationService` as the single home of every money formula.
4. Stateless API (sessions in Postgres) — horizontal scaling needs no architectural change.
5. A versioned URL prefix (`/api/v1`) so a breaking contract can ship alongside the old one.

**Scaling path, in the order the pressure will actually arrive**

| Pressure | Response | Not the response |
|---|---|---|
| Slow list screens | Indexes, keyset pagination, `EXPLAIN ANALYZE` on the top 10 queries | A cache layer |
| Slow dashboard/reports | Materialised views or a nightly rollup table for historical months, live query for the current period | Microservices |
| More concurrent users | API replicas behind the proxy; Postgres connection pooling (PgBouncer) | Rewriting in another stack |
| Read-heavy reporting | A Postgres read replica for the Reports module only — already isolated behind one service | Sharding |
| Background work grows (rent generation, PDFs, future SMS) | Extract a worker process from the same codebase, add a queue (BullMQ) at that point | Adding a queue on day one |
| Files dominate storage | Flip `STORAGE_DRIVER=s3` — one environment variable | A file service |
| A genuine independent scaling need | Extract *that one* module (most likely Notifications or Reporting) behind its existing interface | A wholesale microservice migration |

**When multi-tenancy strategy would change.** Shared-schema-with-`organizationId` is correct up to
thousands of organizations. If a single enterprise customer ever needs physical isolation, the path
is a dedicated database per tenant with the same schema and a connection resolver — the code already
never assumes a single global database, because every query is already tenant-scoped.

**Roadmap alignment.** V2 (tenant portal, SMS/email/WhatsApp) uses the existing provider ports plus
the `TENANT` role that already exists. V3 (M-Pesa, reconciliation, online payments) implements
`PaymentGatewayProvider` and adds a `PaymentIntent`/webhook table beside the existing payment flow —
which is exactly why `Payment` already carries `paymentMethod` and `reference`. V4 (subscription
billing, analytics, mobile) adds a billing module and consumes the same REST API. **None of it is
built now.**

---

## Approval requested

This is the complete blueprint for all 25 requested items. No application code has been written.

On approval I will begin **Phase 1 — Foundation**, and will stop again at the end of it.

If you would rather change something first, the three open questions in §0 (Q1 manager delete rights,
Q2 pro-rata rent, Q3 deposit ledger) are the ones whose answers change the database schema, so they
are cheapest to settle now.
