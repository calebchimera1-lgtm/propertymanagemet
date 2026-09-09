-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'RESIDENTIAL', 'COMMERCIAL', 'OFFICE', 'SHOPS', 'WAREHOUSE', 'MIXED_USE', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BuildingStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('BEDSITTER', 'STUDIO', 'ONE_BEDROOM', 'TWO_BEDROOM', 'THREE_BEDROOM', 'FOUR_BEDROOM', 'SHOP', 'OFFICE', 'WAREHOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('VACANT', 'OCCUPIED', 'RESERVED', 'MAINTENANCE', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "propertyType" "PropertyType" NOT NULL DEFAULT 'RESIDENTIAL',
    "description" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "county" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Kenya',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "imageUrl" TEXT,
    "status" "PropertyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "floors" INTEGER,
    "status" "BuildingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitNumber" TEXT NOT NULL,
    "unitType" "UnitType" NOT NULL DEFAULT 'ONE_BEDROOM',
    "floor" INTEGER,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "monthlyRent" DECIMAL(14,2) NOT NULL,
    "securityDeposit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "UnitStatus" NOT NULL DEFAULT 'VACANT',
    "waterMeterNumber" TEXT,
    "electricityMeterNumber" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_organizationId_idx" ON "Property"("organizationId");

-- CreateIndex
CREATE INDEX "Property_organizationId_status_idx" ON "Property"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Property_organizationId_propertyType_idx" ON "Property"("organizationId", "propertyType");

-- CreateIndex
CREATE INDEX "Property_organizationId_city_idx" ON "Property"("organizationId", "city");

-- CreateIndex
CREATE UNIQUE INDEX "Property_organizationId_id_key" ON "Property"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Property_organizationId_name_key" ON "Property"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Building_organizationId_idx" ON "Building"("organizationId");

-- CreateIndex
CREATE INDEX "Building_organizationId_propertyId_idx" ON "Building"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "Building_organizationId_status_idx" ON "Building"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Building_organizationId_id_key" ON "Building"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Building_propertyId_name_key" ON "Building"("propertyId", "name");

-- CreateIndex
CREATE INDEX "Unit_organizationId_idx" ON "Unit"("organizationId");

-- CreateIndex
CREATE INDEX "Unit_organizationId_status_idx" ON "Unit"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Unit_organizationId_propertyId_idx" ON "Unit"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "Unit_organizationId_buildingId_idx" ON "Unit"("organizationId", "buildingId");

-- CreateIndex
CREATE INDEX "Unit_organizationId_unitType_idx" ON "Unit"("organizationId", "unitType");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_organizationId_id_key" ON "Unit"("organizationId", "id");

-- CreateIndex
CREATE INDEX "StaffAssignment_organizationId_idx" ON "StaffAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "StaffAssignment_userId_idx" ON "StaffAssignment"("userId");

-- CreateIndex
CREATE INDEX "StaffAssignment_organizationId_propertyId_idx" ON "StaffAssignment"("organizationId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignment_userId_propertyId_key" ON "StaffAssignment"("userId", "propertyId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_organizationId_buildingId_fkey" FOREIGN KEY ("organizationId", "buildingId") REFERENCES "Building"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
