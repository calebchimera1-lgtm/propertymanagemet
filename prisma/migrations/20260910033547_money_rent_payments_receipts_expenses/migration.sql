-- CreateEnum
CREATE TYPE "RentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MPESA', 'BANK', 'CASH', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MAINTENANCE', 'REPAIRS', 'SECURITY', 'CLEANING', 'WATER', 'ELECTRICITY', 'GARBAGE', 'SALARIES', 'INSURANCE', 'TAXES', 'MANAGEMENT', 'CONSTRUCTION', 'OTHER');

-- CreateTable
CREATE TABLE "RentRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "expectedAmount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "RentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "rentRecordId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "periodLabel" TEXT,
    "notes" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "idempotencyKey" TEXT,
    "recordedById" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paymentDate" DATE NOT NULL,
    "periodLabel" TEXT,
    "issuedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buildingId" TEXT,
    "unitId" TEXT,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expenseDate" DATE NOT NULL,
    "paymentMethod" "PaymentMethod",
    "vendor" TEXT,
    "reference" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentRecord_organizationId_idx" ON "RentRecord"("organizationId");

-- CreateIndex
CREATE INDEX "RentRecord_organizationId_status_idx" ON "RentRecord"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RentRecord_organizationId_dueDate_idx" ON "RentRecord"("organizationId", "dueDate");

-- CreateIndex
CREATE INDEX "RentRecord_organizationId_periodLabel_idx" ON "RentRecord"("organizationId", "periodLabel");

-- CreateIndex
CREATE INDEX "RentRecord_organizationId_tenantId_idx" ON "RentRecord"("organizationId", "tenantId");

-- CreateIndex
CREATE INDEX "RentRecord_organizationId_propertyId_idx" ON "RentRecord"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "RentRecord_organizationId_leaseId_periodStart_idx" ON "RentRecord"("organizationId", "leaseId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "RentRecord_leaseId_periodStart_key" ON "RentRecord"("leaseId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "RentRecord_organizationId_id_key" ON "RentRecord"("organizationId", "id");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_paymentDate_idx" ON "Payment"("organizationId", "paymentDate");

-- CreateIndex
CREATE INDEX "Payment_organizationId_status_idx" ON "Payment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Payment_organizationId_tenantId_idx" ON "Payment"("organizationId", "tenantId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_propertyId_idx" ON "Payment"("organizationId", "propertyId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_rentRecordId_idx" ON "Payment"("organizationId", "rentRecordId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_paymentMethod_idx" ON "Payment"("organizationId", "paymentMethod");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organizationId_id_key" ON "Payment"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_idx" ON "Receipt"("organizationId");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_paymentDate_idx" ON "Receipt"("organizationId", "paymentDate");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_tenantId_idx" ON "Receipt"("organizationId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_organizationId_receiptNumber_key" ON "Receipt"("organizationId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_organizationId_id_key" ON "Receipt"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_organizationId_paymentId_key" ON "Receipt"("organizationId", "paymentId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_idx" ON "Expense"("organizationId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_expenseDate_idx" ON "Expense"("organizationId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_organizationId_category_idx" ON "Expense"("organizationId", "category");

-- CreateIndex
CREATE INDEX "Expense_organizationId_propertyId_idx" ON "Expense"("organizationId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_id_key" ON "Expense"("organizationId", "id");

-- CreateIndex
CREATE INDEX "NumberSequence_organizationId_idx" ON "NumberSequence"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_organizationId_key_year_key" ON "NumberSequence"("organizationId", "key", "year");

-- AddForeignKey
ALTER TABLE "RentRecord" ADD CONSTRAINT "RentRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentRecord" ADD CONSTRAINT "RentRecord_organizationId_leaseId_fkey" FOREIGN KEY ("organizationId", "leaseId") REFERENCES "Lease"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentRecord" ADD CONSTRAINT "RentRecord_organizationId_tenantId_fkey" FOREIGN KEY ("organizationId", "tenantId") REFERENCES "Tenant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentRecord" ADD CONSTRAINT "RentRecord_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentRecord" ADD CONSTRAINT "RentRecord_organizationId_buildingId_fkey" FOREIGN KEY ("organizationId", "buildingId") REFERENCES "Building"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentRecord" ADD CONSTRAINT "RentRecord_organizationId_unitId_fkey" FOREIGN KEY ("organizationId", "unitId") REFERENCES "Unit"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_leaseId_fkey" FOREIGN KEY ("organizationId", "leaseId") REFERENCES "Lease"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_rentRecordId_fkey" FOREIGN KEY ("organizationId", "rentRecordId") REFERENCES "RentRecord"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_tenantId_fkey" FOREIGN KEY ("organizationId", "tenantId") REFERENCES "Tenant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_buildingId_fkey" FOREIGN KEY ("organizationId", "buildingId") REFERENCES "Building"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_unitId_fkey" FOREIGN KEY ("organizationId", "unitId") REFERENCES "Unit"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_paymentId_fkey" FOREIGN KEY ("organizationId", "paymentId") REFERENCES "Payment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_tenantId_fkey" FOREIGN KEY ("organizationId", "tenantId") REFERENCES "Tenant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_unitId_fkey" FOREIGN KEY ("organizationId", "unitId") REFERENCES "Unit"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_buildingId_fkey" FOREIGN KEY ("organizationId", "buildingId") REFERENCES "Building"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_unitId_fkey" FOREIGN KEY ("organizationId", "unitId") REFERENCES "Unit"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberSequence" ADD CONSTRAINT "NumberSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
