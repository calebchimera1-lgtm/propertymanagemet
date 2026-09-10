import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/app.config';
import { TenantContextMiddleware } from './tenancy/tenant-context.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Config validation has already run by this point: an invalid environment
    // throws during module initialisation, before a port is ever opened.
    bufferLogs: true,
  });

  const config = app.get(AppConfig);
  const logger = new Logger('Bootstrap');
  app.useLogger(
    config.isProduction ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug', 'verbose'],
  );

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());

  // Opens the AsyncLocalStorage scope for every request. Registered here rather
  // than through MiddlewareConsumer so it runs ahead of all guards.
  const tenantContext = app.get(TenantContextMiddleware);
  app.use(tenantContext.use.bind(tenantContext));

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      // Strips unknown properties AND rejects the request that sent them, so a
      // client cannot smuggle organizationId, role or recordedBy into a body.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );

  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Property Management API')
        .setDescription(
          [
            'Multi-tenant property management platform.',
            '',
            'Authentication is a secure HTTP-only cookie session. Every unsafe request must',
            'also send the X-CSRF-Token header, whose value is the pm.csrf cookie.',
            '',
            'Every endpoint is scoped to the caller\'s organization: the organization id comes',
            'from the session and is never accepted from the client.',
          ].join('\n'),
        )
        .setVersion('1.0')
        .addCookieAuth('pm.sid', { type: 'apiKey', in: 'cookie', name: 'pm.sid' })
        .addTag('Auth')
        .addTag('Properties')
        .addTag('Buildings')
        .addTag('Units')
        .addTag('Tenants')
        .addTag('Leases')
        .addTag('Rent')
        .addTag('Payments')
        .addTag('Receipts')
        .addTag('Expenses')
        .addTag('Organization')
        .addTag('Users')
        .addTag('Roles')
        .addTag('Permissions')
        .addTag('Health')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`Swagger UI available at ${config.apiUrl}/api/docs`);
  }

  await app.listen(config.port, '0.0.0.0');
  logger.log(`API listening on ${config.apiUrl}/api/v1 (${config.nodeEnv})`);
}

void bootstrap();
