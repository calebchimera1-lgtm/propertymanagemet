import { SetMetadata } from '@nestjs/common';

export const SKIP_CSRF_KEY = 'skipCsrf';

/**
 * Only for unsafe routes that cannot have a CSRF token yet because no session
 * exists: login, register, forgot-password, reset-password.
 *
 * These are still protected by the SameSite=Lax cookie policy, the CORS
 * allow-list and strict rate limiting.
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
