# Phase 4 — Rent, Payments, Receipts & Expenses

What was built, the decisions behind it, and what deliberately was not built.
Design: [`BLUEPRINT.md`](BLUEPRINT.md) §15–§17, §21, §49.

## Outcome

Generate a month's rent from active leases, record payments against those
charges, issue gapless numbered receipts, void a payment without losing the
record, and track what each property costs to run. Every figure on every screen
is read from the database; nothing is estimated, and nothing is computed in the
browser.

## The transaction that matters

Recording a payment is one database transaction. Anything less and the money and
the balance can disagree:

```ts
await this.prisma.$transaction(async (tx) => {
  const locked = await tx.$queryRaw`
    SELECT "paidAmount"::text, "expectedAmount"::text
    FROM "RentRecord" WHERE "id" = ${rentRecord.id} FOR UPDATE
  `;
  // → refuse overpayment, create the payment, recompute the balance,
  //   take the next receipt number, create the receipt
});
```

`SELECT ... FOR UPDATE` is the load-bearing line. Two cashiers taking the last
30,000 at the same moment is not a hypothetical — the second transaction blocks
until the first commits, then reads the balance the first left behind and is
refused. The suite proves it with two genuinely concurrent requests: one 201,
one 422, one payment applied.

## Money never touches a floating-point number

`Decimal(14, 2)` in PostgreSQL, `Prisma.Decimal` in the service layer, a
fixed-scale **string** on the wire, and a string in the browser that is only
ever formatted for display. `0.1 + 0.2 === 0.30000000000000004`, and a rent roll
that drifts by a cent a month is a rent roll nobody trusts.

`serialiseMoney()` is the one way an amount leaves the API, because
`Decimal.toString()` drops trailing zeros — `65000.00` becomes `"65000"`, which
makes two equal amounts look different and invites a client to parse it.

Every formula lives in `FinanceCalculationService`. There is exactly one
implementation of "net income", so two screens cannot quietly disagree about it.

## Gapless receipt numbers

`RCP-<ORG>-<YEAR>-<000001>`, allocated from a `NumberSequence` row locked
`FOR UPDATE` inside the payment transaction. Not `COUNT(*) + 1`, which races;
not a database sequence, which leaves gaps when a transaction rolls back.

Sequences are per organization, so ABC's first receipt and XYZ's first receipt
are both number 1 — a global counter would leak how much business a competitor
is doing.

## Decisions worth knowing

| Decision | Why |
|---|---|
| A payment **must** name a rent charge | Optional would make reconciliation optional. Every shilling is against a specific month, which is what lets `paidAmount` be proven equal to the sum of its payments |
| **Overpayment is refused**, not held as credit | A credit balance is a real feature with real rules (does it roll forward? is it refundable on move-out?). Refusing with a 422 that names the amount owing is honest; silently absorbing it is not |
| Payments are **never edited or deleted** — only voided | A recorded payment is a historical fact. Voiding reverses the amount, keeps the row, keeps the receipt number, and records who and why |
| Voiding **frees the reference** | The usual reason for a void is that the M-Pesa code was typed against the wrong month. The code has to be reusable for the correct one |
| **Idempotency keys** on payment creation | A dropped connection after the commit means the user presses the button again. The key makes the second request replay the first instead of taking the money twice |
| A **duplicate reference** is a 409 that names the receipt | "SJK4H7X9QP was already used on receipt RCP-ABC-2026-000001" tells the user what happened; "that record already exists" does not |
| **Expired leases are not billed** | Charging rent under a lapsed agreement is a decision for a person. The count of skipped leases is reported back so the omission is visible rather than silent |
| Generation is **idempotent** | `UNIQUE (leaseId, periodStart)` + `skipDuplicates`. A cron re-run, a double-clicked button and a container restart mid-job all collapse to the same single row |
| Rent is billed in **whole months** | No pro-rata in V1. A lease starting on the 20th is charged the full month. The rule is isolated in `rent-period.ts`, so adding pro-rata later touches one file |
| `OVERDUE` beats `PARTIALLY_PAID` | What matters operationally is that money is late, not how much arrived |
| Amounts of **zero are rejected at the DTO** | The `CHECK (amount > 0)` would also stop them, but a constraint violation surfaces as a 500 blaming the server for what the user typed |
| Financial relations are **`onDelete: Restrict`** | Never CASCADE on accounting records. A unit or property carrying charges, payments or expenses refuses deletion with a message naming the counts |

## Four constraints the database enforces on its own

```sql
ALTER TABLE "RentRecord" ADD CONSTRAINT "RentRecord_balance_is_derived"
  CHECK ("balance" = "expectedAmount" - "paidAmount");
ALTER TABLE "RentRecord" ADD CONSTRAINT "RentRecord_amounts_sane"
  CHECK ("expectedAmount" >= 0 AND "paidAmount" >= 0 AND "balance" >= 0
         AND "paidAmount" <= "expectedAmount");
CREATE UNIQUE INDEX "Payment_org_method_reference_key"
  ON "Payment" ("organizationId", "paymentMethod", "reference")
  WHERE "reference" IS NOT NULL;
CREATE UNIQUE INDEX "Payment_org_idempotencyKey_key"
  ON "Payment" ("organizationId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;
```

The first is the important one: a `paidAmount` cannot be written without a
balance that agrees with it, whatever the application does. The suite proves it
by bypassing the service entirely and updating the row directly — PostgreSQL
refuses.

## A real scope bug this phase's tests caught

`POST /rent/generate` ignored the caller's property scope. A caretaker or
accountant assigned to one property could press "Generate charges" and create
rent records for every property in the organization — including ones they cannot
open — and the response reported the count, leaking activity outside their
scope.

Generation now takes the caller's scope, resolved from the session, and the
scheduled job passes `null` for unrestricted. The test that found it asserts
both halves: one charge created, and it belongs to the assigned property.

## Test coverage added

**Unit (`pnpm test:api`)** — 32 new (105 total): every `FinanceCalculationService` formula
including the zero-expected and zero-total edge cases; every rent-period
boundary (February, leap year, December→January, a lease starting on the last
day of a period); the money patterns, including every spelling of zero.

**Integration (`pnpm test:e2e:api`)** — a new `finance.e2e-spec.ts` of 28 tests
against a real PostgreSQL, plus finance rows added to the isolation, permission
and property-scope suites:

- Generation: one charge per active lease, idempotent on re-run, lease rent not
  unit rent, expired leases skipped and counted, bad periods rejected
- Payment: balance recomputed, receipt numbered, part payment, full settlement,
  overpayment refused with nothing written, duplicate reference refused,
  idempotent replay, two concurrent payments serialised, unbroken numbering
- Void: exact reversal, receipt number retained, reference freed, second void
  refused, reason required, voided money out of every total
- **Whole-database reconciliation**: a raw SQL query asserting that for *every*
  charge, `paidAmount` equals the sum of its completed payments and `balance`
  equals `expected − paid` — asked of the database, so a bug in the service
  cannot hide behind the same bug in the assertion
- Isolation: neither organization can read, pay, void, update or delete the
  other's money; both receipt sequences start at 1; a cross-organization payment
  is refused by the foreign key even with the API bypassed
- Scope: an accountant assigned to one property sees only its rent, payments,
  receipts and expenses — including in the summary totals — cannot pay a charge
  outside it, cannot widen scope through a filter, and generates rent only for
  what they can see; a caretaker sees expenses only and gets 403 on rent

**End-to-end (`pnpm test:e2e`)** — 5 Playwright journeys on desktop and mobile:
charge rent → take a part payment → open the printable receipt; a duplicate
M-Pesa code refused on the field naming the receipt that used it; void a payment
and watch the balance come back; record an expense and reject an amount of zero;
the tenant profile showing charged, paid and outstanding.

Full suite: 105 unit, 266 integration and 48 Playwright tests, all passing
against a real PostgreSQL and both real servers.

## Screens

`/rent` (rent roll with charged/collected/outstanding/overdue, period and status
filters, "Generate charges", per-row "Record payment"), `/payments` (with void),
`/receipts` and `/receipts/[id]` (a printable document — `Ctrl+P` produces the
receipt and none of the application around it), `/expenses` (with category
summary). The tenant profile and lease detail now show real money instead of a
"arrives in Phase 4" placeholder.

## Not built in Phase 4

Stated plainly rather than stubbed:

- **No M-Pesa integration.** M-Pesa references are typed by hand, and the
  payment dialog says so. Nothing is fetched from Safaricom; automatic
  reconciliation is a later version
- **No receipt emailing or PDF export.** The receipt prints from the browser.
  Email delivery is not enabled anywhere in V1
- **No credit balances or refunds.** Overpayment is refused rather than held
- **No partial-month pro-rata.** Whole months only, isolated in `rent-period.ts`
- **No late fees or penalty interest.** `OVERDUE` is reported, not charged for
- **No deposit ledger.** Deposits are recorded on the lease, not accounted
- **No profit and loss report yet.** The pieces exist — collected rent, expenses
  by category, `netIncome()` — but the reporting module is Phase 6, and building
  half of it here would mean two definitions of the same numbers
- **No expense approval workflow or attachments.** Documents arrive in Phase 5

## Verified on

PostgreSQL 16, Node 22, `pnpm 9`. Migrations `20260910033547_money_...` and
`20260910033600_money_invariants` applied cleanly from an empty database and on
top of Phase 3.
