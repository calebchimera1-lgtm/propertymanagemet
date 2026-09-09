import { Prisma } from '@pm/database';
import { TENANT_SCOPED_MODELS } from './tenant-scope.extension';

/**
 * The tenant filter can only protect models it knows about. Adding a
 * tenant-owned table to the schema and forgetting to register it here would be
 * a silent cross-organization leak, so this test closes that gap: every model
 * carrying organizationId must either be scoped or be listed below with a
 * reason.
 */
describe('tenant scope coverage', () => {
  const EXEMPT: Record<string, string> = {
    // System roles are shared by every organization and are seeded, not
    // user-created; their organizationId is null. Per-organization custom roles
    // would have to be added to TENANT_SCOPED_MODELS when they arrive.
    Role: 'System roles are global configuration with a null organizationId',
  };

  const modelsWithOrganizationId = Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === 'organizationId'))
    .map((model) => model.name);

  it('finds the tenant-owned models in the schema', () => {
    expect(modelsWithOrganizationId.length).toBeGreaterThan(0);
  });

  it.each(
    Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === 'organizationId'))
      .map((model) => model.name),
  )('%s is tenant-scoped or explicitly exempt', (modelName) => {
    const scoped = TENANT_SCOPED_MODELS.has(modelName);
    const exempt = modelName in EXEMPT;

    if (!scoped && !exempt) {
      throw new Error(
        `Model "${modelName}" has an organizationId but is not in TENANT_SCOPED_MODELS. ` +
          'Add it there, or add it to EXEMPT in this spec with a written reason.',
      );
    }
    expect(scoped || exempt).toBe(true);
  });

  it('does not scope models that have no organizationId', () => {
    const withoutOrgId = Prisma.dmmf.datamodel.models
      .filter((model) => !model.fields.some((field) => field.name === 'organizationId'))
      .map((model) => model.name);

    for (const modelName of withoutOrgId) {
      expect(TENANT_SCOPED_MODELS.has(modelName)).toBe(false);
    }
  });
});
