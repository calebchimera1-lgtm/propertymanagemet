-- Financial invariants Prisma's schema language cannot express.
--
-- These are the constraints that make the money trustworthy. Every one of them
-- exists because the alternative is a number in a report that quietly disagrees
-- with what actually happened.

-- ── The same transaction cannot be banked twice ─────────────────────────────
-- An M-Pesa code, bank slip or cheque number identifies one real-world payment.
-- Partial, because a reference is optional (cash usually has none) and NULLs
-- must stay distinct — without WHERE, only one cash payment per method could
-- ever be recorded.
CREATE UNIQUE INDEX "Payment_org_method_reference_key"
  ON "Payment" ("organizationId", "paymentMethod", "reference")
  WHERE "reference" IS NOT NULL;

-- ── A retried request must not take the money twice ─────────────────────────
CREATE UNIQUE INDEX "Payment_org_idempotencyKey_key"
  ON "Payment" ("organizationId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- ── Amounts ─────────────────────────────────────────────────────────────────
-- A payment of zero is not a payment, and a negative one is a refund the system
-- has no concept of. Refusing both keeps "total collected" honest.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_amount_positive" CHECK ("amount" > 0);

-- ── Rent record arithmetic ──────────────────────────────────────────────────
-- Version 1 rejects overpayment rather than inventing a credit balance, so
-- paidAmount can never exceed what was charged, and the balance can never go
-- negative.
ALTER TABLE "RentRecord"
  ADD CONSTRAINT "RentRecord_amounts_sane"
  CHECK (
    "expectedAmount" >= 0 AND
    "paidAmount" >= 0 AND
    "balance" >= 0 AND
    "paidAmount" <= "expectedAmount"
  );

-- The stored balance is a derived value with one writer. This makes a wrong
-- write impossible rather than merely unlikely: any code path that updates
-- paidAmount without recomputing balance is refused by the database.
ALTER TABLE "RentRecord"
  ADD CONSTRAINT "RentRecord_balance_is_derived"
  CHECK ("balance" = "expectedAmount" - "paidAmount");

-- A rental period runs forward.
ALTER TABLE "RentRecord"
  ADD CONSTRAINT "RentRecord_period_forward" CHECK ("periodEnd" >= "periodStart");

-- ── Voiding ─────────────────────────────────────────────────────────────────
-- A voided payment carries when it happened; a live one does not.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_voided_has_date"
  CHECK (
    ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL) OR
    ("status" = 'COMPLETED' AND "voidedAt" IS NULL)
  );

-- ── Receipt numbering ───────────────────────────────────────────────────────
ALTER TABLE "NumberSequence"
  ADD CONSTRAINT "NumberSequence_lastValue_nonnegative" CHECK ("lastValue" >= 0);
