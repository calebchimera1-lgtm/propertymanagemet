import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { CsrfGuard, PermissionsGuard, SessionAuthGuard } from '@/common/guards';
import { AppConfig } from '@/config/app.config';
import { ConfigModule } from '@/config/config.module';
import { JobsModule } from '@/jobs/jobs.module';
import { AuditLogsModule } from '@/modules/audit-logs/audit-logs.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BuildingsModule } from '@/modules/buildings/buildings.module';
import { DocumentsModule } from '@/modules/documents/documents.module';
import { ExpensesModule } from '@/modules/expenses/expenses.module';
import { MaintenanceModule } from '@/modules/maintenance/maintenance.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { StaffModule } from '@/modules/staff/staff.module';
import { HealthModule } from '@/modules/health/health.module';
import { LeasesModule } from '@/modules/leases/leases.module';
import { OrganizationsModule } from '@/modules/organizations/organizations.module';
import { PermissionsModule } from '@/modules/permissions/permissions.module';
import { PropertiesModule } from '@/modules/properties/properties.module';
import { PaymentsModule } from '@/modules/payments/payments.module';
import { ReceiptsModule } from '@/modules/receipts/receipts.module';
import { RentModule } from '@/modules/rent/rent.module';
import { RolesModule } from '@/modules/roles/roles.module';
import { TenantsModule } from '@/modules/tenants/tenants.module';
import { UnitsModule } from '@/modules/units/units.module';
import { UsersModule } from '@/modules/users/users.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { ProvidersModule } from '@/providers/providers.module';
import { TenancyModule } from '@/tenancy/tenancy.module';

/**
 * The modular monolith's composition root.
 *
 * Guard order below is load-bearing and matches the request pipeline in
 * docs/BLUEPRINT.md §1: rate limit → authenticate → CSRF → authorize.
 * CSRF sits after authentication because the expected token is derived from
 * the session; unauthenticated unsafe routes opt out with @SkipCsrf.
 */
@Module({
  imports: [
    ConfigModule,
    TenancyModule,
    PrismaModule,
    ProvidersModule,
    AuditLogsModule,
    NotificationsModule,
    PermissionsModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: config.rateLimit.ttl * 1000, limit: config.rateLimit.limit }],
      }),
    }),

    AuthModule,
    OrganizationsModule,
    UsersModule,
    RolesModule,
    PropertiesModule,
    BuildingsModule,
    UnitsModule,
    TenantsModule,
    LeasesModule,
    RentModule,
    PaymentsModule,
    ReceiptsModule,
    ExpensesModule,
    MaintenanceModule,
    StaffModule,
    DocumentsModule,
    HealthModule,
    JobsModule,
  ],
  providers: [
    // Registered by class and bound with useExisting rather than useClass so
    // integration tests can swap the limiter out; useClass would key the
    // instance to APP_GUARD and make it unreachable by an override.
    ThrottlerGuard,
    { provide: APP_GUARD, useExisting: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
