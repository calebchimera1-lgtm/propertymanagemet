-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'ALIEN_ID', 'MILITARY_ID', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'TERMINATED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "idType" "IdType",
    "nationalId" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "occupation" TEXT,
    "address" TEXT,
    "photoUrl" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "monthlyRent" DECIMAL(14,2) NOT NULL,
    "securityDeposit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "depositPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dueDay" INTEGER NOT NULL,
    "status" "LeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "terminatedAt" TIMESTAMP(3),
    "terminationReason" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tenant_organizationId_idx" ON "Tenant"("organizationId");

-- CreateIndex
CREATE INDEX "Tenant_organizationId_isActive_idx" ON "Tenant"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "Tenant_organizationId_fullName_idx" ON "Tenant"("organizationId", "fullName");

-- CreateIndex
CREATE INDEX "Tenant_organizationId_phone_idx" ON "Tenant"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_organizationId_id_key" ON "Tenant"("organizationId", "id");

-- CreateIndex
CREATE INDEX "Lease_organizationId_idx" ON "Lease"("organizationId");

-- CreateIndex
CREATE INDEX "Lease_organizationId_status_idx" ON "Lease"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Lease_organizationId_status_endDate_idx" ON "Lease"("organizationId", "status", "endDate");

-- CreateIndex
CREATE INDEX "Lease_organizationId_tenantId_idx" ON "Lease"("organizationId", "tenantId");

-- CreateIndex
CREATE INDEX "Lease_organizationId_unitId_idx" ON "Lease"("organizationId", "unitId");

-- CreateIndex
CREATE INDEX "Lease_organizationId_propertyId_idx" ON "Lease"("organizationId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Lease_organizationId_id_key" ON "Lease"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_organizationId_tenantId_fkey" FOREIGN KEY ("organizationId", "tenantId") REFERENCES "Tenant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_organizationId_buildingId_fkey" FOREIGN KEY ("organizationId", "buildingId") REFERENCES "Building"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_organizationId_unitId_fkey" FOREIGN KEY ("organizationId", "unitId") REFERENCES "Unit"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
