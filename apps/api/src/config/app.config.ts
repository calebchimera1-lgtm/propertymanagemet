import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/**
 * Typed accessor over the validated environment. Nothing in the codebase reads
 * process.env directly — that way "which settings exist" has exactly one answer.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true }) as Env[K];
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }
  get port(): number {
    return this.get('API_PORT');
  }
  get apiUrl(): string {
    return this.get('API_URL');
  }
  get appUrl(): string {
    return this.get('APP_URL');
  }
  get corsOrigins(): string[] {
    return this.get('CORS_ORIGIN');
  }
  get sessionSecret(): string {
    return this.get('SESSION_SECRET');
  }
  get sessionTtlDays(): number {
    return this.get('SESSION_TTL_DAYS');
  }
  get sessionAbsoluteTtlDays(): number {
    return this.get('SESSION_ABSOLUTE_TTL_DAYS');
  }
  get cookieName(): string {
    return this.get('COOKIE_NAME');
  }
  get csrfCookieName(): string {
    return this.get('CSRF_COOKIE_NAME');
  }
  get cookieDomain(): string | undefined {
    const value = this.get('COOKIE_DOMAIN');
    return value && value.length > 0 ? value : undefined;
  }
  get cookieSecure(): boolean {
    return this.get('COOKIE_SECURE');
  }
  get argon2Options() {
    return {
      memoryCost: this.get('ARGON2_MEMORY_COST'),
      timeCost: this.get('ARGON2_TIME_COST'),
      parallelism: this.get('ARGON2_PARALLELISM'),
    };
  }
  get rateLimit() {
    return { ttl: this.get('RATE_LIMIT_TTL'), limit: this.get('RATE_LIMIT_LIMIT') };
  }
  get swaggerEnabled(): boolean {
    return this.get('SWAGGER_ENABLED');
  }
  get logLevel(): Env['LOG_LEVEL'] {
    return this.get('LOG_LEVEL');
  }
  get defaultCurrency(): string {
    return this.get('DEFAULT_CURRENCY');
  }
  get defaultTimezone(): string {
    return this.get('DEFAULT_TIMEZONE');
  }
  get emailDriver(): Env['EMAIL_DRIVER'] {
    return this.get('EMAIL_DRIVER');
  }
  get emailFrom(): string {
    return this.get('EMAIL_FROM');
  }
  get storageDriver(): Env['STORAGE_DRIVER'] {
    return this.get('STORAGE_DRIVER');
  }
  get storageLocalPath(): string {
    return this.get('STORAGE_LOCAL_PATH');
  }
  /** The cap the upload pipeline enforces, in bytes. */
  get maxUploadBytes(): number {
    return this.get('MAX_UPLOAD_SIZE_MB') * 1024 * 1024;
  }
}
