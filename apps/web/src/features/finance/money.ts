/**
 * The amount format the API accepts for a payment or an expense: a plain
 * decimal string, at most two places, strictly above zero.
 *
 * Deliberately the same rule as the server's POSITIVE_MONEY_PATTERN. The
 * server is what enforces it — this copy only exists so the user is told at the
 * input rather than after a round trip.
 */
export const POSITIVE_MONEY = /^(?!0+(\.0{1,2})?$)\d{1,12}(\.\d{1,2})?$/;
