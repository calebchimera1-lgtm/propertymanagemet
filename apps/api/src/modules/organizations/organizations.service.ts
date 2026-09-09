import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@/common/errors/domain.errors';
import { PrismaService } from '@/prisma/prisma.service';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type { UpdateOrganizationDto, UpdateSettingsDto } from './dto/organization.dto';

/**
 * Organization is the tenant boundary itself, so it is not in the scoped-model
 * set — there is nothing to filter it by. Instead every query here is keyed by
 * the organization id from the session, which amounts to the same guarantee:
 * a caller can only ever read or write their own organization.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  async current() {
    const organization = await this.prisma.organization.findUnique({
      where: { id: this.tenant.organizationId },
      select: {
        id: true,
        name: true,
        code: true,
        email: true,
        phone: true,
        addressLine: true,
        city: true,
        county: true,
        country: true,
        currency: true,
        timezone: true,
        logoUrl: true,
        status: true,
        createdAt: true,
      },
    });
    if (!organization) throw new NotFoundError('Organization');
    return organization;
  }

  async update(dto: UpdateOrganizationDto) {
    const auth = this.tenant.getOrThrow();
    const organization = await this.prisma.organization.update({
      where: { id: auth.organizationId },
      data: { ...dto },
      select: { id: true, name: true, code: true, status: true },
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.ORGANIZATION_UPDATED,
      entityType: 'Organization',
      entityId: organization.id,
      metadata: { changed: Object.keys(dto) },
    });

    return this.current();
  }

  async settings() {
    const settings = await this.prisma.settings.findUnique({
      where: { organizationId: this.tenant.organizationId },
    });
    if (!settings) throw new NotFoundError('Settings');
    return settings;
  }

  async updateSettings(dto: UpdateSettingsDto) {
    const auth = this.tenant.getOrThrow();
    const settings = await this.prisma.settings.update({
      where: { organizationId: auth.organizationId },
      data: { ...dto },
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: 'Settings',
      entityId: settings.id,
      metadata: { changed: Object.keys(dto) },
    });

    return settings;
  }
}
