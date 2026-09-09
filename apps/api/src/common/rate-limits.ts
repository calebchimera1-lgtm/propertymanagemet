/**
 * Per-route rate-limit buckets for the authentication endpoints.
 *
 * These are read from process.env directly rather than through AppConfig
 * because @Throttle() is a decorator: its arguments are evaluated when the
 * controller class is defined, long before the DI container exists. The same
 * variables are declared in the Zod environment schema, so a malformed value
 * still stops the process at boot.
 *
 * The defaults are the production values. Raising them is an explicit,
 * environment-level decision — most usefully for the end-to-end suite, which
 * creates more organizations in a minute than a real tenant does in a year.
 */
function limitFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const HOUR = 3_600_000;
const FIFTEEN_MINUTES = 900_000;

/** Registration: 5 new organizations per hour, per IP. */
export const REGISTER_THROTTLE = {
  default: { limit: limitFrom('AUTH_REGISTER_LIMIT', 5), ttl: HOUR },
};

/** Sign-in: 10 attempts per 15 minutes, per IP (account lockout is separate). */
export const LOGIN_THROTTLE = {
  default: { limit: limitFrom('AUTH_LOGIN_LIMIT', 10), ttl: FIFTEEN_MINUTES },
};

/** Password reset, verification resend and similar: 5 per 15 minutes, per IP. */
export const SENSITIVE_THROTTLE = {
  default: { limit: limitFrom('AUTH_SENSITIVE_LIMIT', 5), ttl: FIFTEEN_MINUTES },
};
