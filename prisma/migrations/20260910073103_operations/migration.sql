-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "DocumentEntityType" AS ENUM ('PROPERTY', 'BUILDING', 'UNIT', 'TENANT', 'LEASE', 'EXPENSE', 'MAINTENANCE', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('RENT_OVERDUE', 'PAYMENT_RECORDED', 'LEASE_EXPIRING', 'MAINTENANCE_UPDATED', 'SYSTEM');

-- CreateTable
CREATE TABLE "MaintenanceRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitId" TEXT,
    "tenantId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "estimatedCost" DECIMAL(14,2),
    "actualCost" DECIMAL(14,2),
    "reportedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceUpdate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "maintenanceRequestId" TEXT NOT NULL,
    "authorId" TEXT,
    "note" TEXT NOT NULL,
    "fromStatus" "MaintenanceStatus",
    "toStatus" "MaintenanceStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" "DocumentEntityType" NOT NULL,
    "entityId" TEXT,
    "name" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceRequest_organizationId_idx" ON "MaintenanceRequest"("organizationId");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_organizationId_status_idx" ON "MaintenanceRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_organizationId_priority_idx" ON "MaintenanceRequest"("organizationId", "priority");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_organizationId_propertyId_idx" ON "MaintenanceRequest"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_organizationId_assignedToId_idx" ON "MaintenanceRequest"("organizationId", "assignedToId");

-- CreateIndex
CREATE INDEX "MaintenanceRequest_organizationId_status_createdAt_idx" ON "MaintenanceRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceRequest_organizationId_id_key" ON "MaintenanceRequest"("organizationId", "id");

-- CreateIndex
CREATE INDEX "MaintenanceUpdate_organizationId_idx" ON "MaintenanceUpdate"("organizationId");

-- CreateIndex
CREATE INDEX "MaintenanceUpdate_organizationId_maintenanceRequestId_creat_idx" ON "MaintenanceUpdate"("organizationId", "maintenanceRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "Document_organizationId_entityType_entityId_idx" ON "Document"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Document_organizationId_createdAt_idx" ON "Document"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_storageKey_key" ON "Document"("organizationId", "storageKey");

-- CreateIndex
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_readAt_idx" ON "Notification"("organizationId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_createdAt_idx" ON "Notification"("organizationId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_organizationId_buildingId_fkey" FOREIGN KEY ("organizationId", "buildingId") REFERENCES "Building"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_organizationId_unitId_fkey" FOREIGN KEY ("organizationId", "unitId") REFERENCES "Unit"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_organizationId_tenantId_fkey" FOREIGN KEY ("organizationId", "tenantId") REFERENCES "Tenant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceUpdate" ADD CONSTRAINT "MaintenanceUpdate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceUpdate" ADD CONSTRAINT "MaintenanceUpdate_organizationId_maintenanceRequestId_fkey" FOREIGN KEY ("organizationId", "maintenanceRequestId") REFERENCES "MaintenanceRequest"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceUpdate" ADD CONSTRAINT "MaintenanceUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
