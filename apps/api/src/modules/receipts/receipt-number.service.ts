import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pm/database';

/**
 * The minimum a transaction client must provide here.
 *
 * Typed structurally rather than as Prisma.TransactionClient because the
 * tenant-scoped client's transaction type is its own extended shape — this
 * accepts either without either having to know about the other.
 */
export interface RawTransactionClient {
  $executeRaw(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<number>;
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<T>;
}

/**
 * Gapless, per-organization receipt numbers.
 *
 * A Postgres sequence would be simpler, but sequences do not roll back: a
 * failed payment would burn a number and leave a hole in the receipt book,
 * which is exactly what an auditor asks about. A counter row locked FOR UPDATE
 * inside the payment transaction rolls back with everything else.
 *
 * The lock also serialises concurrent payments in the same organization for the
 * few milliseconds it takes to increment — which is what makes two simultaneous
 * receipts impossible to number identically.
 */
@Injectable()
export class ReceiptNumberService {
  /**
   * Must be called inside a transaction. Taking a number outside one would
   * hand it out without the write that consumes it.
   */
  async next(
    tx: RawTransactionClient,
    organizationId: string,
    prefix: string,
    organizationCode: string,
    year: number,
  ): Promise<string> {
    // Ensure the counter exists without racing: two concurrent inserts collapse
    // into one row, and the SELECT ... FOR UPDATE below then serialises them.
    await tx.$executeRaw`
      INSERT INTO "NumberSequence" ("id", "organizationId", "key", "year", "lastValue", "updatedAt")
      VALUES (gen_random_uuid()::text, ${organizationId}, 'RECEIPT', ${year}, 0, NOW())
      ON CONFLICT ("organizationId", "key", "year") DO NOTHING
    `;

    const rows = await tx.$queryRaw<{ lastValue: number }[]>`
      SELECT "lastValue" FROM "NumberSequence"
      WHERE "organizationId" = ${organizationId} AND "key" = 'RECEIPT' AND "year" = ${year}
      FOR UPDATE
    `;

    const nextValue = (rows[0]?.lastValue ?? 0) + 1;

    await tx.$executeRaw`
      UPDATE "NumberSequence" SET "lastValue" = ${nextValue}, "updatedAt" = NOW()
      WHERE "organizationId" = ${organizationId} AND "key" = 'RECEIPT' AND "year" = ${year}
    `;

    return `${prefix}-${organizationCode}-${year}-${String(nextValue).padStart(6, '0')}`;
  }
}
