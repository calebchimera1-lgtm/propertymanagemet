import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { ConflictError, NotFoundError, ValidationError } from '@/common/errors/domain.errors';
import { serialiseMoney, toDecimal } from '@/common/money/money';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { parseDateOnly, todayUtc } from '@/modules/leases/lease-dates';
import { FinanceCalculationService } from '@/modules/rent/finance-calculation.service';
import { ReceiptNumberService } from '@/modules/receipts/receipt-number.service';
import { PrismaService } from '@/prisma/prisma.service';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type { CreatePaymentDto, ListPaymentsQueryDto, VoidPaymentDto } from './dto/payment.dto';

const PAYMENT_SELECT = {
  id: true,
  tenantId: true,
  propertyId: true,
  unitId: true,
  leaseId: true,
  rentRecordId: true,
  amount: true,
  paymentDate: true,
  paymentMethod: true,
  reference: true,
  periodLabel: true,
  notes: true,
  status: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  tenant: { select: { id: true, fullName: true, phone: true } },
  unit: { select: { id: true, unitNumber: true } },
  property: { select: { id: true, name: true } },
  receipt: { select: { id: true, receiptNumber: true, voidedAt: true } },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    private readonly prisma: PrismaService,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
    private readonly finance: FinanceCalculationService,
    private readonly receiptNumbers: ReceiptNumberService,
  ) {}

  private serialise(payment: PaymentRow) {
    return { ...payment, amount: serialiseMoney(payment.amount) };
  }

  async list(query: ListPaymentsQueryDto) {
    if (query.propertyId) this.scope.assertProperty(query.propertyId, 'Payment');

    const where: Prisma.PaymentWhereInput = {
      ...this.scope.where(),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      // Voided payments are excluded by default: a payments list that silently
      // includes reversed money is a list nobody can add up.
      ...(query.status ? { status: query.status } : { status: 'COMPLETED' }),
      ...(query.propertyId ? { propertyId: query.propertyId } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.rentRecordId ? { rentRecordId: query.rentRecordId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            paymentDate: {
              ...(query.dateFrom ? { gte: parseDateOnly(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: parseDateOnly(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' } },
              { tenant: { fullName: { contains: query.search, mode: 'insensitive' } } },
              { unit: { unitNumber: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total, aggregate] = await Promise.all([
      this.db.payment.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'paymentDate']: query.sortOrder },
        select: PAYMENT_SELECT,
      }),
      this.db.payment.count({ where }),
      this.db.payment.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      ...paginated(rows.map((row) => this.serialise(row)), total, query.page, query.limit),
      totalAmount: serialiseMoney(aggregate._sum.amount),
    };
  }

  async findOne(id: string) {
    const payment = await this.db.payment.findFirst({
      where: { id, ...this.scope.where() },
      select: {
        ...PAYMENT_SELECT,
        rentRecord: {
          select: {
            id: true,
            periodLabel: true,
            expectedAmount: true,
            paidAmount: true,
            balance: true,
            status: true,
          },
        },
      },
    });
    if (!payment) throw new NotFoundError('Payment');

    const { rentRecord, ...rest } = payment;
    return {
      ...this.serialise(rest),
      rentRecord: {
        ...rentRecord,
        expectedAmount: serialiseMoney(rentRecord.expectedAmount),
        paidAmount: serialiseMoney(rentRecord.paidAmount),
        balance: serialiseMoney(rentRecord.balance),
      },
    };
  }

  /**
   * Recording money. The most important transaction in the product.
   *
   * Everything below happens together or not at all:
   *   1. the rent record is locked FOR UPDATE, so two concurrent payments
   *      cannot both read the same balance and both think they fit
   *   2. the payment row is written
   *   3. the rent record's paidAmount, balance and status are recomputed
   *   4. a gapless receipt number is taken and the receipt is issued
   *
   * If step 4 fails, step 2 never happened. That is the difference between a
   * system that can be audited and one that cannot.
   */
  async create(dto: CreatePaymentDto, idempotencyKey?: string) {
    const auth = this.tenant.getOrThrow();

    // A retried request replays its original response rather than taking the
    // money twice — the case that matters when a phone loses signal mid-submit.
    if (idempotencyKey) {
      const existing = await this.db.payment.findFirst({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        this.logger.log(`Replaying payment ${existing.id} for idempotency key`);
        return { ...(await this.findOne(existing.id)), replayed: true };
      }
    }

    const amount = toDecimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new ValidationError('A payment must be for more than zero.', [
        { field: 'amount', message: 'Enter an amount greater than zero.' },
      ]);
    }

    const paymentDate = parseDateOnly(dto.paymentDate);
    if (Number.isNaN(paymentDate.getTime())) {
      throw new ValidationError('The payment date is not a valid date.', [
        { field: 'paymentDate', message: 'Enter a date such as 2026-09-05.' },
      ]);
    }
    if (paymentDate > todayUtc()) {
      throw new ValidationError('A payment cannot be dated in the future.', [
        { field: 'paymentDate', message: 'Choose today or an earlier date.' },
      ]);
    }

    const rentRecord = await this.db.rentRecord.findFirst({
      where: { id: dto.rentRecordId, ...this.scope.where() },
      select: {
        id: true,
        leaseId: true,
        tenantId: true,
        propertyId: true,
        buildingId: true,
        unitId: true,
        periodLabel: true,
        expectedAmount: true,
        paidAmount: true,
        balance: true,
        dueDate: true,
      },
    });
    if (!rentRecord) throw new NotFoundError('Rent record');

    // The same transaction code cannot be banked twice. Checked here for a
    // readable message; the partial unique index is what guarantees it.
    if (dto.reference) {
      const duplicate = await this.db.payment.findFirst({
        where: { paymentMethod: dto.paymentMethod, reference: dto.reference, status: 'COMPLETED' },
        select: { id: true, receipt: { select: { receiptNumber: true } } },
      });
      if (duplicate) {
        throw new ConflictError(
          'DUPLICATE_PAYMENT_REFERENCE',
          'A payment with this reference has already been recorded.',
          [
            {
              field: 'reference',
              message: duplicate.receipt
                ? `Already used on receipt ${duplicate.receipt.receiptNumber}.`
                : 'This reference is already recorded.',
            },
          ],
        );
      }
    }

    const settings = await this.db.settings.findFirst({
      where: { organizationId: auth.organizationId },
      select: { receiptPrefix: true },
    });
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: auth.organizationId },
      select: { code: true },
    });

    try {
      const { payment, receipt, updatedRecord } = await this.db.$transaction(async (tx) => {
        /*
         * Lock the charge before reading its balance.
         *
         * Without this, two payments submitted at the same instant both read a
         * balance of 30,000, both decide 20,000 fits, and the record ends up
         * with 40,000 paid against a 30,000 charge. The CHECK constraint would
         * catch it, but as a 500 rather than a clean refusal — the lock makes
         * the second request simply wait and then see the truth.
         */
        const locked = await tx.$queryRaw<{ paidAmount: string; expectedAmount: string }[]>`
          SELECT "paidAmount"::text, "expectedAmount"::text FROM "RentRecord"
          WHERE "id" = ${rentRecord.id} FOR UPDATE
        `;
        const row = locked[0];
        if (!row) throw new NotFoundError('Rent record');

        const expectedAmount = toDecimal(row.expectedAmount);
        const alreadyPaid = toDecimal(row.paidAmount);
        const currentBalance = this.finance.balanceOf(expectedAmount, alreadyPaid);

        if (amount.greaterThan(currentBalance)) {
          // Version 1 refuses overpayment rather than inventing a credit
          // balance. Credit handling is real accounting work, and a fake
          // version of it would be worse than not having it.
          throw new ValidationError(
            `That is more than the ${serialiseMoney(currentBalance)} still owing on this charge.`,
            [
              {
                field: 'amount',
                message: `Enter ${serialiseMoney(currentBalance)} or less.`,
              },
            ],
          );
        }

        const newPaid = alreadyPaid.plus(amount);
        const newBalance = this.finance.balanceOf(expectedAmount, newPaid);
        const newStatus = this.finance.rentStatusOf(
          expectedAmount,
          newPaid,
          rentRecord.dueDate,
          todayUtc(),
        );

        const payment = await tx.payment.create({
          data: {
            organizationId: auth.organizationId,
            tenantId: rentRecord.tenantId,
            propertyId: rentRecord.propertyId,
            buildingId: rentRecord.buildingId,
            unitId: rentRecord.unitId,
            leaseId: rentRecord.leaseId,
            rentRecordId: rentRecord.id,
            amount,
            paymentDate,
            paymentMethod: dto.paymentMethod,
            reference: dto.reference ?? null,
            periodLabel: rentRecord.periodLabel,
            notes: dto.notes ?? null,
            status: 'COMPLETED',
            idempotencyKey: idempotencyKey ?? null,
            recordedById: auth.userId,
          },
          select: PAYMENT_SELECT,
        });

        const updatedRecord = await tx.rentRecord.update({
          where: { id: rentRecord.id },
          data: { paidAmount: newPaid, balance: newBalance, status: newStatus },
          select: { id: true, paidAmount: true, balance: true, status: true },
        });

        const receiptNumber = await this.receiptNumbers.next(
          tx,
          auth.organizationId,
          settings?.receiptPrefix ?? 'RCP',
          organization.code,
          paymentDate.getUTCFullYear(),
        );

        const receipt = await tx.receipt.create({
          data: {
            organizationId: auth.organizationId,
            paymentId: payment.id,
            receiptNumber,
            tenantId: rentRecord.tenantId,
            propertyId: rentRecord.propertyId,
            unitId: rentRecord.unitId,
            amount,
            paymentMethod: dto.paymentMethod,
            reference: dto.reference ?? null,
            paymentDate,
            periodLabel: rentRecord.periodLabel,
            issuedById: auth.userId,
          },
          select: { id: true, receiptNumber: true },
        });

        return { payment, receipt, updatedRecord };
      });

      await this.audit.record({
        organizationId: auth.organizationId,
        userId: auth.userId,
        actorEmail: auth.email,
        action: AUDIT_ACTIONS.PAYMENT_RECORDED,
        entityType: 'Payment',
        entityId: payment.id,
        metadata: {
          amount: serialiseMoney(amount),
          method: dto.paymentMethod,
          receiptNumber: receipt.receiptNumber,
          rentRecordId: rentRecord.id,
          newBalance: serialiseMoney(updatedRecord.balance),
        },
      });

      return {
        ...this.serialise(payment),
        receipt,
        rentRecord: {
          id: updatedRecord.id,
          paidAmount: serialiseMoney(updatedRecord.paidAmount),
          balance: serialiseMoney(updatedRecord.balance),
          status: updatedRecord.status,
        },
        replayed: false,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // The unique index caught what the pre-check could not: a reference or
        // idempotency key submitted twice at the same instant.
        throw new ConflictError(
          'DUPLICATE_PAYMENT_REFERENCE',
          'This payment appears to have just been recorded. Refresh before trying again.',
        );
      }
      throw error;
    }
  }

  /**
   * The only way to correct a payment.
   *
   * Payments are append-only, so this reverses rather than edits: the row stays
   * with its original amount, marked VOIDED, and the rent record is put back
   * exactly where it was. The receipt keeps its number — a gap in a receipt
   * book is what an auditor asks about.
   */
  async void(id: string, dto: VoidPaymentDto) {
    const auth = this.tenant.getOrThrow();

    const payment = await this.db.payment.findFirst({
      where: { id, ...this.scope.where() },
      select: {
        id: true,
        amount: true,
        status: true,
        rentRecordId: true,
        reference: true,
        rentRecord: { select: { id: true, dueDate: true } },
      },
    });
    if (!payment) throw new NotFoundError('Payment');

    if (payment.status === 'VOIDED') {
      throw new ConflictError('PAYMENT_ALREADY_VOIDED', 'This payment has already been voided.');
    }

    const result = await this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ paidAmount: string; expectedAmount: string }[]>`
        SELECT "paidAmount"::text, "expectedAmount"::text FROM "RentRecord"
        WHERE "id" = ${payment.rentRecordId} FOR UPDATE
      `;
      const row = locked[0];
      if (!row) throw new NotFoundError('Rent record');

      const expectedAmount = toDecimal(row.expectedAmount);
      // Decimal subtraction, so reversing a payment lands exactly back where it
      // started rather than a cent away from it.
      const newPaid = toDecimal(row.paidAmount).minus(payment.amount);
      const newBalance = this.finance.balanceOf(expectedAmount, newPaid);
      const newStatus = this.finance.rentStatusOf(
        expectedAmount,
        newPaid,
        payment.rentRecord.dueDate,
        todayUtc(),
      );

      await tx.payment.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedById: auth.userId,
          voidReason: dto.reason,
          // Freeing the reference lets the real payment be re-recorded with its
          // true transaction code.
          reference: null,
        },
      });

      await tx.rentRecord.update({
        where: { id: payment.rentRecordId },
        data: { paidAmount: newPaid, balance: newBalance, status: newStatus },
      });

      await tx.receipt.updateMany({ where: { paymentId: id }, data: { voidedAt: new Date() } });

      return { paidAmount: newPaid, balance: newBalance, status: newStatus };
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.PAYMENT_VOIDED,
      entityType: 'Payment',
      entityId: id,
      metadata: {
        amount: serialiseMoney(payment.amount),
        reason: dto.reason,
        originalReference: payment.reference,
        restoredBalance: serialiseMoney(result.balance),
      },
    });

    return this.findOne(id);
  }
}
