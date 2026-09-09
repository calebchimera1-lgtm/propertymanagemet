import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface GeneratedToken {
  /** Sent to the user. Never stored. */
  token: string;
  /** Stored. Cannot be turned back into the token. */
  tokenHash: string;
}

/**
 * Single-use tokens for password reset and email verification.
 *
 * Same discipline as sessions: the database only ever holds a hash, so a stolen
 * row cannot be turned into a working link.
 */
@Injectable()
export class TokenService {
  generate(): GeneratedToken {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  expiresIn(minutes: number): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
  }
}

export const PASSWORD_RESET_TTL_MINUTES = 60;
export const EMAIL_VERIFICATION_TTL_MINUTES = 60 * 24;
