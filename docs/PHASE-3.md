# Phase 3 — Tenants & Leases

What was built, the decisions behind it, and what deliberately was not built.
Design: [`BLUEPRINT.md`](BLUEPRINT.md) §13–§14, §21.

## Outcome

Record a tenant, move them into a vacant unit, and the unit's status follows in
the same transaction. Renew or end the lease; the unit is released only when
someone actually ends it. Tenants get a 360 profile with their current lease and
full history.

## The invariant: one active lease per unit

```sql
CREATE UNIQUE INDEX "Lease_one_active_per_unit"
  ON "Lease" ("unitId") WHERE "status" = 'ACTIVE';
```

Two active leases on one unit would mean two tenants billed for the same room —
and from Phase 4, two streams of rent records against it.

Partial, because the rule applies only to ACTIVE leases: a unit accumulates any
number of TERMINATED and EXPIRED leases over its life, and that history has to
be preserved. The service checks availability too, so the usual case gets a
readable 409 — but the index is what makes it true under concurrency, and the
suite proves it with two genuinely simultaneous requests: one 201, one 409, one
active lease, one occupied unit.

## Decisions worth knowing

| Decision | Why |
|---|---|
| **Expiry does not free the unit** | A tenant staying past the end date is normal. Marking the unit vacant would contradict what is happening on the ground and make it lettable to someone else. The lease goes EXPIRED and stays on the renewals worklist until a person renews or ends it |
| Rent and deposit are **copied onto the lease** | Raising a unit's advertised rent must not rewrite what a sitting tenant agreed to pay. From Phase 4, rent records are generated from the lease's figure, never the unit's |
| Tenant, unit and start date are **immutable** on a lease | Changing who or where a lease is for silently rewrites history. Terminate and create a new lease — that leaves an honest trail |
| `EXPIRING_SOON`/`EXPIRED` are **derived** | A nightly job transitions them from the calendar, per organization, using each one's warning window. Idempotent: a missed night is corrected by the next run. Two sources of truth for "has this lease ended" is how a renewals list starts lying |
| Terminating can leave the unit in **maintenance** | A move-out that needs repairs first is common; forcing VACANT would advertise a unit nobody can occupy |
| A tenant with lease history **cannot be deleted** | Once someone has held a lease they are part of the record — from Phase 4, the financial record. Deactivating hides them; deleting is for a row created by mistake |
| Deposits are **recorded, not ledgered** | `depositPaid` cannot exceed `securityDeposit` (a CHECK constraint). Deductions and move-out refunds are a real accounting feature, deliberately out of V1 — the UI says "recorded, not held in a refund ledger" rather than implying otherwise |
| `dueDay` is capped at **28** | Rent must fall due on a day every month actually has, or February silently skips a billing cycle |
| Calendar dates are parsed at **UTC midnight** | `new Date('2026-01-01')` on a server west of UTC lands on 2025-12-31, shifting a lease — and from Phase 4, a rent period — by a day |

## Property scope reaches tenants through their leases

A tenant belongs to the organization, not to a property, so scope cannot filter
the Tenant row directly. It is applied through the tenant's leases: a caretaker
assigned to one property sees the people leasing there, and nobody else.

## A real bug the end-to-end suite caught

The lease dialog asked for `limit: 200` tenants; the pagination DTO caps at 100,
so the API returned 400 and the tenant picker **silently rendered empty** — a
failure that looked exactly like "no tenants exist". Fixed the page size, and
added an explicit error state, because an empty dropdown must not be
indistinguishable from a failed request. The dialog now also says when it is
showing the first 100 of more.

## Test coverage added

| Suite | Added | Total |
|---|---|---|
| Jest unit | lease date handling, including the timezone-shift trap | 69 |
| Supertest integration | tenants CRUD and 360 profile, lease lifecycle, the concurrency race, expiry derivation, isolation and scope rows for every new endpoint | 192 |
| Playwright | move-in/move-out, double-let prevention, holdover expiry, renewal with rent review, blocked deletion, honest finance section — desktop **and** mobile | 37 |

Assertions worth naming:

- Two simultaneous lease requests for one unit: `[201, 409]`, one active lease.
- Raising a unit's rent leaves the sitting tenant's lease at its agreed figure.
- An expired lease leaves its unit `OCCUPIED`.
- Deriving statuses twice is a no-op the second time.
- The database refuses a cross-organization lease with the API bypassed.

## Not built in Phase 3

- **Rent, payments, receipts, balances.** Phase 4. The tenant profile and lease
  detail name their absence rather than showing a zero balance, which would
  read as "nothing owed".
- **Deposit refund ledger** — deductions, refunds on move-out (open question Q3).
- **Pro-rata rent** for mid-month starts (open question Q2). It changes how
  Phase 4 generates the first rent record, so it is still worth settling.
- **Tenant documents and photos.** `photoUrl` is on the model; uploads need the
  DocumentsModule in Phase 5.
- **Tenant portal login.** The `TENANT` role exists in the matrix; a tenant is
  not a User in V1.

## Verified on

Node 22, pnpm 10, PostgreSQL 16, against a live database with both servers
running. Docker images and compose files are written and reviewed but were not
run — no Docker daemon in this environment.
