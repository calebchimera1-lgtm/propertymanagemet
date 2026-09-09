# Phase 2 — Property Management

What was built, the decisions behind it, and what deliberately was not built.
Design: [`BLUEPRINT.md`](BLUEPRINT.md) §10–§12, §21.

## Outcome

Build a real portfolio: properties → buildings → units with rent, and browse it
with server-side search, filtering, sorting and pagination. Property scoping is
now live, which closes the honest gap left open at the end of Phase 1.

## The structural guarantee: composite foreign keys

Every child in the portfolio carries `organizationId` as part of its foreign key:

```sql
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_organizationId_propertyId_fkey"
  FOREIGN KEY ("organizationId", "propertyId")
  REFERENCES "Property"("organizationId", "id");
```

A unit therefore cannot reference another organization's property — not
"should not", cannot. `org-isolation.e2e-spec.ts` proves it by bypassing the
API entirely and writing straight through Prisma; the database refuses.

This is the layer that still holds if every guard above it were removed.

## Property scoping (multi-tenancy layer 4)

`StaffAssignment` decides which properties a `CARETAKER` or `ACCOUNTANT` may
see. `PropertyScopeService` turns that into a query fragment composed into every
portfolio query, and an `assertProperty()` call on every by-id read.

Three properties of the design worth stating:

- **Fail closed.** `null` means unrestricted; `[]` means restricted to nothing.
  They are different values and never collapse. A scoped user with no
  assignments sees zero rows — there is no code path where an empty list means
  "no filter".
- **404, never 403.** Telling a caretaker that a property exists but is not
  theirs is more than they should know.
- **Not a route guard.** The blueprint drew this as `PropertyScopeGuard`. A
  guard runs before the handler and cannot know which rows a list endpoint is
  about to touch, so scoping has to be *in the query*. Implemented as a service
  used by every portfolio query instead.

## Decisions worth knowing

| Decision | Why |
|---|---|
| Deleting a building **detaches** its units | Units carry the rentable history everything financial will hang off. The units move to the parent property inside the same transaction; the response reports how many |
| `onDelete: Restrict`, not `SetNull`, on `Unit → Building` | Prisma flagged it: the composite FK includes the required `organizationId`, so a cascade-to-null would try to null the tenant column and fail. The detach is explicit and audited instead |
| A building cannot change property | It would relocate every unit beneath it and orphan lease history from Phase 3. `propertyId` is `OmitType`d out of the update DTO, so the request is rejected rather than ignored |
| `OCCUPIED` is not settable by hand | From Phase 3 it is derived from an active lease. A hand-set value would put the unit table and the lease table into permanent disagreement |
| Property delete is refused while non-empty | 409 naming the counts, pointing at archive. Archiving is reversible; deletion is not |
| Money is a **fixed-scale string** end to end | `Decimal.toString()` drops trailing zeros — 65000.00 becomes "65000" — which makes equal amounts look different and invites the client to parse it. `serialiseMoney()` is the one way money leaves the API |
| `sortBy` is an allow-list | It goes into a query. An arbitrary column name is not something to shrug at — `?sortBy=passwordHash` is a 400 |

## Two bugs found by the tests, fixed properly

1. **The property-scope cache was a correctness bug.** A 60-second TTL meant a
   revoked assignment kept working for up to a minute, and a new one took that
   long to apply. Removed — it is one indexed lookup by user id, and only for
   the scoped roles. Correctness beats the micro-optimisation.
2. **`declare propertyId?: never` did nothing at runtime.** It removes the field
   from TypeScript but leaves its class-validator metadata in place, so the
   property stayed whitelisted and the update was accepted. Replaced with
   `OmitType`, which makes the pipe reject it.

## Test coverage added

| Suite | Added | Total |
|---|---|---|
| Jest unit | `PropertyScopeService`, money serialisation (incl. the 0.1 + 0.2 float trap) | 56 |
| Supertest integration | portfolio CRUD, isolation rows for **every** new endpoint, the database-level FK proof, property scope | 132 |
| Playwright | portfolio journey, duplicate-name handling, invalid rent, filtering, building deletion, blocked property deletion — desktop **and** mobile | 25 |

Assertions worth naming:

- `"32000"` in, `"32000.00"` out — the scale is part of the contract.
- Two units called "S1" under one property are refused even with no building,
  which a plain composite unique index would allow (Postgres treats NULLs as
  distinct); a partial index does not.
- Deleting a building leaves its unit alive, detached, with its rent intact.
- A caretaker filtering by an unassigned property gets 404, not a leak.

## Not built in Phase 2

- **Staff management UI.** `StaffAssignment` exists and is enforced, but
  creating staff and granting assignments is the Phase 5 StaffModule. Today
  assignments are made by the seed or directly in the database.
- **Property images.** `imageUrl` is on the model; uploads need the
  DocumentsModule (Phase 5).
- **Occupancy that means anything.** Every seeded unit is `VACANT` because
  there are no tenants yet. Seeding a mix of `OCCUPIED` units with no lease
  behind them would be inventing data the rest of the system cannot explain.
  Real occupancy arrives with leases in Phase 3.
- **Map coordinates in the UI.** `latitude`/`longitude` are stored and
  validated; no map is rendered.

## Verified on

Node 22, pnpm 10, PostgreSQL 16, against a live database, with both servers
running. Docker images and compose files are written and reviewed but were not
run — no Docker daemon in this environment.
