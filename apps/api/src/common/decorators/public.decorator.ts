import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable without a session (login, register, health).
 * Everything else requires authentication — the global guard denies by default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
