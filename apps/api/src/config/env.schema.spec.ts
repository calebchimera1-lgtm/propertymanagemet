import { validateEnv } from './env.schema';

describe('environment validation', () => {
  const valid = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://pm:pm@localhost:5432/pm?schema=public',
    SESSION_SECRET: 'a'.repeat(32),
  };

  it('accepts a minimal valid environment and fills in defaults', () => {
    const env = validateEnv(valid);
    expect(env.API_PORT).toBe(3001);
    expect(env.SESSION_TTL_DAYS).toBe(7);
    expect(env.DEFAULT_CURRENCY).toBe('KES');
    expect(env.CORS_ORIGIN).toEqual(['http://localhost:3000']);
  });

  it('refuses to start without a session secret', () => {
    const { SESSION_SECRET, ...withoutSecret } = valid;
    void SESSION_SECRET;
    expect(() => validateEnv(withoutSecret)).toThrow(/SESSION_SECRET/);
  });

  it('refuses a session secret that is too short to be a secret', () => {
    expect(() => validateEnv({ ...valid, SESSION_SECRET: 'short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('refuses insecure cookies in production', () => {
    expect(() =>
      validateEnv({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE/);
  });

  it('refuses the example session secret in production', () => {
    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        SESSION_SECRET: 'change-me-to-a-long-random-value-at-least-32-chars',
      }),
    ).toThrow(/still the example value/);
  });

  it('refuses a sliding TTL longer than the absolute ceiling', () => {
    expect(() =>
      validateEnv({ ...valid, SESSION_TTL_DAYS: '60', SESSION_ABSOLUTE_TTL_DAYS: '30' }),
    ).toThrow(/cannot exceed/);
  });

  it('requires S3 credentials when the S3 driver is selected', () => {
    expect(() => validateEnv({ ...valid, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });

  it('parses a comma-separated CORS allow-list', () => {
    const env = validateEnv({
      ...valid,
      CORS_ORIGIN: 'http://localhost:3000, https://app.example.com',
    });
    expect(env.CORS_ORIGIN).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });
});
