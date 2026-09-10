-- Occupancy invariants Prisma's schema language cannot express.

-- ── One active lease per unit ───────────────────────────────────────────────
-- The single most important constraint in this phase. Two active leases on one
-- unit would mean two tenants billed for the same room, and from Phase 4 two
-- streams of rent records against it.
--
-- A partial index, because the rule applies only to ACTIVE leases: a unit
-- accumulates any number of TERMINATED and EXPIRED leases over its life, and
-- that history must be preserved.
--
-- The service checks this too, to return a readable 409 — but the database is
-- what makes it true under concurrency, where two simultaneous requests both
-- pass an application-level check and only one can win the unique index.
CREATE UNIQUE INDEX "Lease_one_active_per_unit"
  ON "Lease" ("unitId")
  WHERE "status" = 'ACTIVE';

-- ── Tenant identity ─────────────────────────────────────────────────────────
-- An ID number identifies one person within an organization. Partial, because
-- it is optional and Postgres treats NULLs as distinct — without WHERE, any
-- number of tenants with no ID on file would be fine, which is correct, but a
-- plain unique index would also allow two tenants sharing a real ID number.
CREATE UNIQUE INDEX "Tenant_org_nationalId_key"
  ON "Tenant" ("organizationId", "nationalId")
  WHERE "nationalId" IS NOT NULL;

-- ── Lease value constraints ─────────────────────────────────────────────────
-- A lease that ends before it starts is not a lease.
ALTER TABLE "Lease"
  ADD CONSTRAINT "Lease_dates_coherent"
  CHECK ("endDate" IS NULL OR "endDate" > "startDate");

-- Rent falls due on a day every month actually has.
ALTER TABLE "Lease"
  ADD CONSTRAINT "Lease_dueDay_range"
  CHECK ("dueDay" >= 1 AND "dueDay" <= 28);

ALTER TABLE "Lease"
  ADD CONSTRAINT "Lease_money_nonnegative"
  CHECK ("monthlyRent" >= 0 AND "securityDeposit" >= 0 AND "depositPaid" >= 0);

-- You cannot have received more deposit than the lease asks for. Version 1
-- records deposits rather than running a refundable-deposit ledger, so an
-- overpayment here would have nowhere to go.
ALTER TABLE "Lease"
  ADD CONSTRAINT "Lease_depositPaid_within_deposit"
  CHECK ("depositPaid" <= "securityDeposit");

-- A terminated lease has a termination date, and a live one does not.
ALTER TABLE "Lease"
  ADD CONSTRAINT "Lease_terminated_has_date"
  CHECK (
    ("status" = 'TERMINATED' AND "terminatedAt" IS NOT NULL) OR
    ("status" <> 'TERMINATED' AND "terminatedAt" IS NULL)
  );
