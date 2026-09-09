-- Business invariants that Prisma's schema language cannot express.
-- These are as much a part of the data model as the tables themselves: they
-- hold even if every guard in the API were bypassed.

-- ── Role uniqueness ─────────────────────────────────────────────────────────
-- A plain composite unique index would not work: Postgres treats NULLs as
-- distinct, so it would happily allow two global PROPERTY_OWNER roles.
CREATE UNIQUE INDEX "Role_system_name_key"
  ON "Role" ("name")
  WHERE "organizationId" IS NULL;

CREATE UNIQUE INDEX "Role_org_name_key"
  ON "Role" ("organizationId", "name")
  WHERE "organizationId" IS NOT NULL;

-- ── Value constraints ───────────────────────────────────────────────────────
-- Rent can never fall due on the 29th–31st: those days do not exist in every
-- month, and a lease that silently skips February is a billing bug.
ALTER TABLE "Settings"
  ADD CONSTRAINT "Settings_defaultDueDay_range"
  CHECK ("defaultDueDay" >= 1 AND "defaultDueDay" <= 28);

ALTER TABLE "Settings"
  ADD CONSTRAINT "Settings_leaseExpiryWarningDays_range"
  CHECK ("leaseExpiryWarningDays" >= 1 AND "leaseExpiryWarningDays" <= 365);

ALTER TABLE "User"
  ADD CONSTRAINT "User_failedLoginCount_nonnegative"
  CHECK ("failedLoginCount" >= 0);

-- Emails are normalised to lowercase before they are written, so the unique
-- index on (organizationId, email) actually prevents duplicate accounts.
-- Without this, Alice@x.com and alice@x.com would be two different users.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_lowercase"
  CHECK ("email" = lower("email"));

-- Sliding expiry may extend expiresAt, but never past the absolute ceiling.
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_expiry_within_absolute"
  CHECK ("expiresAt" <= "absoluteExpiresAt");

-- Organization codes appear in receipt numbers; keep them predictable.
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_code_format"
  CHECK ("code" ~ '^[A-Z0-9]{3,12}$');
