import { Prisma } from '@pm/database';

/** Every monetary column in the schema is Decimal(14, 2). */
export const MONEY_SCALE = 2;

/**
 * An amount as it arrives on the wire: a plain decimal string, at most two
 * decimal places, no sign and no separators. Zero is allowed — a deposit of
 * nothing is a real thing to record.
 */
export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * The same, but strictly above zero.
 *
 * Payments and expenses carry a `CHECK (amount > 0)` in the database. Without
 * this pattern in front of it, "0.00" passes validation and the constraint
 * fires instead — and a constraint violation surfaces as a 500 saying
 * "something went wrong on our side", which is both untrue and unhelpful.
 * Rejecting it here turns the same rule into a field error on the amount box.
 */
export const POSITIVE_MONEY_PATTERN = /^(?!0+(\.0{1,2})?$)\d{1,12}(\.\d{1,2})?$/;

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
