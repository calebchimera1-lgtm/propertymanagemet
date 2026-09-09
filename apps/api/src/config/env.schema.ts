import { z } from 'zod';

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : value.toLowerCase() === 'true'));

const csvList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().url()).min(1));

/**
 * The whole environment, validated once at boot. If anything here is missing or
 * malformed the process exits instead of starting with a silent default — a
 * missing SESSION_SECRET must never become an empty string.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: z.string().url().optional(),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_URL: z.string().url().default('http://localhost:3001'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGIN: csvList.default('http://localhost:3000'),

    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48'),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    COOKIE_NAME: z.string().min(1).default('pm.sid'),
    CSRF_COOKIE_NAME: z.string().min(1).default('pm.csrf'),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: booleanFromString.default(false),

    ARGON2_MEMORY_COST: z.coerce.number().int().min(8192).default(65536),
    ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(4),

    RATE_LIMIT_TTL: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_LIMIT: z.coerce.number().int().min(1).default(120),
    // Auth-route buckets. Strict by default; raised only for an automated
    // end-to-end run, which registers far more organizations in an hour than
    // any real deployment ever should.
    AUTH_REGISTER_LIMIT: z.coerce.number().int().min(1).default(5),
    AUTH_LOGIN_LIMIT: z.coerce.number().int().min(1).default(10),
    AUTH_SENSITIVE_LIMIT: z.coerce.number().int().min(1).default(5),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage/uploads'),
    MAX_UPLOAD_SIZE_MB: z.coerce.number().int().min(1).max(100).default(10),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    EMAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
    EMAIL_FROM: z.string().email().default('no-reply@example.com'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    SWAGGER_ENABLED: booleanFromString.default(true),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'verbose']).default('info'),
    DEFAULT_CURRENCY: z.string().length(3).default('KES'),
    DEFAULT_TIMEZONE: z.string().min(1).default('Africa/Nairobi'),
  })
  .superRefine((env, ctx) => {
    if (env.SESSION_TTL_DAYS > env.SESSION_ABSOLUTE_TTL_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_TTL_DAYS'],
        message: 'SESSION_TTL_DAYS cannot exceed SESSION_ABSOLUTE_TTL_DAYS.',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECURE'],
          message: 'COOKIE_SECURE must be true in production: session cookies must never travel over HTTP.',
        });
      }
      if (env.SESSION_SECRET.includes('change-me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SESSION_SECRET'],
          message: 'SESSION_SECRET is still the example value.',
        });
      }
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3.`,
          });
        }
      }
    }
    if (env.EMAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when EMAIL_DRIVER=smtp.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Used as NestJS ConfigModule's `validate`. Throwing here stops the process
 * before a single request can be served.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
