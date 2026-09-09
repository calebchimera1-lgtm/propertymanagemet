import { Injectable } from '@nestjs/common';
import { checkPassword } from '@pm/validation';
import * as argon2 from 'argon2';
import { ERROR_CODES } from '@pm/types';
import { DomainError } from '@/common/errors/domain.errors';
import { AppConfig } from '@/config/app.config';

/**
 * Argon2id password hashing.
 *
 * A dummy hash is verified against on the "no such user" path so a login
 * attempt costs the same whether the email exists or not — otherwise response
 * timing becomes a user-enumeration oracle.
 */
@Injectable()
export class PasswordService {
  private dummyHash: string | null = null;

  constructor(private readonly config: AppConfig) {}

  private get options(): argon2.Options {
    const { memoryCost, timeCost, parallelism } = this.config.argon2Options;
    return { type: argon2.argon2id, memoryCost, timeCost, parallelism };
  }

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed hash must read as "wrong password", not as a server error.
      return false;
    }
  }

  /** Burns the same CPU as a real verification, for unknown-email logins. */
  async verifyDummy(plain: string): Promise<void> {
    this.dummyHash ??= await argon2.hash('dummy-password-for-constant-time', this.options);
    await this.verify(this.dummyHash, plain);
  }

  /**
   * Backend-authoritative password policy. The web app runs the same function
   * from @pm/validation for instant feedback, but this call is the one that
   * decides.
   */
  assertAcceptable(plain: string, context: { email?: string } = {}): void {
    const problems = checkPassword(plain, context);
    if (problems.length > 0) {
      throw new DomainError(
        ERROR_CODES.WEAK_PASSWORD,
        'That password does not meet the security requirements.',
        422,
        problems.map((problem) => ({ field: 'password', message: problem.message })),
      );
    }
  }
}
