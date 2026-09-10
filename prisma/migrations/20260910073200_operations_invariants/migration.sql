-- Operations invariants: the rules that outlive the application code.
--
-- Prisma cannot express partial unique indexes or CHECK constraints, so they
-- are written by hand here. Each one is a rule the database keeps whatever a
-- service, a script or a future developer does.

-- One alert per user, per fact, per day.
--
-- The daily sweeps are idempotent by design, but "idempotent" has to be true
-- under a re-run, a container restart mid-job, and two workers racing. NULL
-- dedupeKey means "always deliver" (a one-off SYSTEM message), so the index is
-- partial rather than covering every row.
CREATE UNIQUE INDEX "Notification_org_user_dedupeKey_key"
  ON "Notification" ("organizationId", "userId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;

-- Costs are amounts, not signed adjustments. A negative estimate is a data
-- entry error, and it would flow straight into the maintenance report.
ALTER TABLE "MaintenanceRequest"
  ADD CONSTRAINT "MaintenanceRequest_costs_non_negative"
  CHECK (("estimatedCost" IS NULL OR "estimatedCost" >= 0)
     AND ("actualCost" IS NULL OR "actualCost" >= 0));

-- completedAt and COMPLETED must agree.
--
-- Two sources of truth for "is this job finished" is how a maintenance report
-- starts disagreeing with the board it was built from.
ALTER TABLE "MaintenanceRequest"
  ADD CONSTRAINT "MaintenanceRequest_completed_has_date"
  CHECK (("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
      OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL));

-- A file with no bytes is a failed upload, not a document.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_size_positive" CHECK ("sizeBytes" > 0);

-- SHA-256 is always 64 lowercase hex characters. A short or empty checksum
-- means the hashing step was skipped, which would make the column a lie.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_checksum_is_sha256" CHECK ("checksum" ~ '^[0-9a-f]{64}$');

-- Only ORGANIZATION-level documents may have no owning record. Anything else
-- with a null entityId is unreachable from the record it belongs to.
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_entity_id_required"
  CHECK ("entityType" = 'ORGANIZATION' OR "entityId" IS NOT NULL);
