import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  type Permission,
  type RoleName,
} from '@pm/types';
import type { PrismaClient } from '@pm/database';

/**
 * Reconciles the permission catalogue and the system roles with the code in
 * @pm/types. Safe to run in every environment, including production, and safe
 * to run repeatedly: it adds what is missing, updates what has changed, and
 * removes role-permission links that no longer exist in the matrix.
 *
 * This is why adding a permission to the array in @pm/types is genuinely all
 * that is needed to make it real.
 */
export async function seedPermissionsAndRoles(prisma: PrismaClient): Promise<void> {
  // ── Permissions ───────────────────────────────────────────────────────────
  for (const key of PERMISSIONS) {
    const [resource, action] = key.split('.') as [string, string];
    await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action, description: PERMISSION_DESCRIPTIONS[key] },
      update: { resource, action, description: PERMISSION_DESCRIPTIONS[key] },
    });
  }

  const removedPermissions = await prisma.permission.deleteMany({
    where: { key: { notIn: [...PERMISSIONS] } },
  });
  if (removedPermissions.count > 0) {
    console.log(`  removed ${removedPermissions.count} permission(s) no longer in the catalogue`);
  }

  const permissionRows = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permissionIdByKey = new Map(permissionRows.map((p) => [p.key, p.id]));

  // ── System roles (organizationId = null, shared by every organization) ─────
  for (const name of ROLE_NAMES) {
    const existing = await prisma.role.findFirst({ where: { name, organizationId: null } });
    const data = {
      name,
      label: ROLE_LABELS[name],
      description: ROLE_DESCRIPTIONS[name],
      isSystem: true,
      organizationId: null,
    };

    const role = existing
      ? await prisma.role.update({ where: { id: existing.id }, data })
      : await prisma.role.create({ data });

    await reconcileRolePermissions(prisma, role.id, ROLE_PERMISSIONS[name], permissionIdByKey);
  }

  console.log(
    `  ${PERMISSIONS.length} permissions and ${ROLE_NAMES.length} system roles reconciled`,
  );
}

async function reconcileRolePermissions(
  prisma: PrismaClient,
  roleId: string,
  wanted: Permission[],
  permissionIdByKey: Map<string, string>,
): Promise<void> {
  const wantedIds = new Set(
    wanted
      .map((key) => permissionIdByKey.get(key))
      .filter((id): id is string => typeof id === 'string'),
  );

  const current = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { id: true, permissionId: true },
  });
  const currentIds = new Set(current.map((row) => row.permissionId));

  const toAdd = [...wantedIds].filter((id) => !currentIds.has(id));
  const toRemove = current.filter((row) => !wantedIds.has(row.permissionId)).map((row) => row.id);

  if (toAdd.length > 0) {
    await prisma.rolePermission.createMany({
      data: toAdd.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    });
  }
  if (toRemove.length > 0) {
    await prisma.rolePermission.deleteMany({ where: { id: { in: toRemove } } });
  }
}

/** Convenience for tests and the demo seed. */
export async function roleIdByName(prisma: PrismaClient, name: RoleName): Promise<string> {
  const role = await prisma.role.findFirst({ where: { name, organizationId: null } });
  if (!role) throw new Error(`System role ${name} is missing. Run the permission seed first.`);
  return role.id;
}
