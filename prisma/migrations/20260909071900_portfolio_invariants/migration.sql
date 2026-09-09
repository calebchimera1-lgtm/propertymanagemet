-- Portfolio invariants Prisma's schema language cannot express.

-- ── Unit numbering ──────────────────────────────────────────────────────────
-- "A1" must be unique within its block, and within the property for units that
-- sit directly under it. A plain composite unique on (propertyId, buildingId,
-- unitNumber) would not do the second half: Postgres treats NULL buildingIds as
-- distinct, so a property could hold two units both called "A1".
CREATE UNIQUE INDEX "Unit_building_number_key"
  ON "Unit" ("propertyId", "buildingId", "unitNumber")
  WHERE "buildingId" IS NOT NULL;

CREATE UNIQUE INDEX "Unit_property_number_key"
  ON "Unit" ("propertyId", "unitNumber")
  WHERE "buildingId" IS NULL;

-- ── Value constraints ───────────────────────────────────────────────────────
-- Rent and deposit are money: never negative, and never a floating-point value
-- (the column type already guarantees the second half).
ALTER TABLE "Unit"
  ADD CONSTRAINT "Unit_monthlyRent_nonnegative" CHECK ("monthlyRent" >= 0);

ALTER TABLE "Unit"
  ADD CONSTRAINT "Unit_securityDeposit_nonnegative" CHECK ("securityDeposit" >= 0);

ALTER TABLE "Unit"
  ADD CONSTRAINT "Unit_counts_sane"
  CHECK (
    ("bedrooms"  IS NULL OR ("bedrooms"  >= 0 AND "bedrooms"  <= 50)) AND
    ("bathrooms" IS NULL OR ("bathrooms" >= 0 AND "bathrooms" <= 50)) AND
    ("floor"     IS NULL OR ("floor"     >= -10 AND "floor"   <= 200))
  );

ALTER TABLE "Building"
  ADD CONSTRAINT "Building_floors_sane"
  CHECK ("floors" IS NULL OR ("floors" >= 1 AND "floors" <= 200));

-- Coordinates that are not coordinates make a map silently wrong.
ALTER TABLE "Property"
  ADD CONSTRAINT "Property_coordinates_valid"
  CHECK (
    ("latitude"  IS NULL OR ("latitude"  >= -90  AND "latitude"  <= 90)) AND
    ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180))
  );
