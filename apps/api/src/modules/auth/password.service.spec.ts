import { DomainError } from '@/common/errors/domain.errors';
import type { AppConfig } from '@/config/app.config';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  // Low cost factors: the algorithm under test is the same, only the work is less.
  const config = {
    argon2Options: { memoryCost: 8192, timeCost: 2, parallelism: 1 },
  } as AppConfig;

  const service = new PasswordService(config);

  it('produces an Argon2id hash, not the plaintext', async () => {
    const hash = await service.hash('CorrectHorseBattery9');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('CorrectHorseBattery9');
  });

  it('produces a different hash each time (salted)', async () => {
    const [a, b] = await Promise.all([service.hash('SamePassword123'), service.hash('SamePassword123')]);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await service.hash('CorrectHorseBattery9');
    await expect(service.verify(hash, 'CorrectHorseBattery9')).resolves.toBe(true);
    await expect(service.verify(hash, 'correcthorsebattery9')).resolves.toBe(false);
    await expect(service.verify(hash, '')).resolves.toBe(false);
  });

  it('treats a malformed hash as a wrong password rather than an error', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('accepts a password that meets the policy', () => {
    expect(() => service.assertAcceptable('CorrectHorseBattery9')).not.toThrow();
  });

  it.each([
    ['too short', 'Short1'],
    ['no uppercase', 'alllowercase123'],
    ['no lowercase', 'ALLUPPERCASE123'],
    ['no digit', 'NoDigitsInHere'],
    ['too common', 'password123'],
  ])('rejects a password that is %s', (_label, password) => {
    expect(() => service.assertAcceptable(password)).toThrow(DomainError);
  });

  it('rejects a password containing the email local part', () => {
    expect.assertions(2);
    try {
      service.assertAcceptable('Amina12345678', { email: 'amina@abc.test' });
    } catch (error) {
      const domainError = error as DomainError;
      expect(domainError.code).toBe('WEAK_PASSWORD');
      // The generic message is what the user sees; the reason is in the details.
      expect(domainError.details?.[0]?.message).toMatch(/must not contain your email/i);
    }
  });

  it('reports every policy failure at once, as field details', () => {
    try {
      service.assertAcceptable('short');
      throw new Error('should have thrown');
    } catch (error) {
      const domainError = error as DomainError;
      expect(domainError.status).toBe(422);
      expect(domainError.details?.length).toBeGreaterThan(1);
      expect(domainError.details?.every((detail) => detail.field === 'password')).toBe(true);
    }
  });
});
