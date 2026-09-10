import { Injectable } from '@nestjs/common';
import { PROPERTY_SCOPED_ROLES, type Permission, type RoleName } from '@pm/types';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Who should be told.
 *
 * An alert is a disclosure: telling a caretaker that unit 4B owes 30,000 tells
 * them how much 4B pays, which the permission matrix says they may not know. So
 * recipients are resolved the same way a request is authorized — by permission,
 * and then by property scope — rather than by "everyone in the organization".
 *
 * Runs from scheduled jobs as well as requests, so it takes an explicit
 * organizationId and uses the unscoped client.
 */
@Injectable()
export class NotificationRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Users in the organization who hold `permission` and, if they are
   * property-scoped, are assigned to `propertyId`.
   *
   * `propertyId` omitted means the alert is not about a particular property, so
   * scoped roles are excluded entirely — a caretaker has no business receiving
   * an organization-wide notice they cannot act on.
   */
  async forPermission(
    organizationId: string,
    permission: Permission,
    propertyId?: string,
  ): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        roles: { some: { role: { permissions: { some: { permission: { key: permission } } } } } },
      },
      select: {
        id: true,
        roles: { select: { role: { select: { name: true } } } },
        staffAssignments: { select: { propertyId: true } },
      },
    });

    const recipients: string[] = [];
    for (const user of users) {
      const roles = user.roles.map((link) => link.role.name as RoleName);
      const isScoped =
        roles.length > 0 && roles.every((role) => PROPERTY_SCOPED_ROLES.includes(role));

      if (!isScoped) {
        recipients.push(user.id);
        continue;
      }
      if (!propertyId) continue;
      if (user.staffAssignments.some((assignment) => assignment.propertyId === propertyId)) {
        recipients.push(user.id);
      }
    }
    return recipients;
  }
}
