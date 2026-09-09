import { Prisma } from '@pm/database';

/** Every monetary column in the schema is Decimal(14, 2). */
export const MONEY_SCALE = 2;

/**
 * The one way money leaves the API.
 *
 * `Decimal.toString()` drops trailing zeros — 65000.00 becomes "65000" — which
 * makes two equal amounts look different and invites a client to parse it as a
 * number. Fixing the scale keeps the wire format stable and unmistakably not a
 * JSON number.
 */
export function serialiseMoney(value: Prisma.Decimal | string | number | null | undefined): string {
  if (value === null || value === undefined) return '0.00';
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  return decimal.toFixed(MONEY_SCALE);
}

/** Parses an amount from a request. Callers validate the format first. */
export function toDecimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}
