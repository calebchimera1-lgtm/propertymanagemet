import { NotFoundError } from '@/common/errors/domain.errors';
import type { PrismaService } from '@/prisma/prisma.service';
import { PropertyScopeService } from './property-scope.service';
import type { AuthContext } from './tenant-context';
import type { TenantContextService } from './tenant-context.service';

describe('PropertyScopeService', () => {
  function serviceWithScope(scopedPropertyIds: string[] | null) {
    const tenant = {
      getOrThrow: () => ({ scopedPropertyIds }) as AuthContext,
    } as TenantContextService;
    return new PropertyScopeService({} as PrismaService, tenant);
  }

  describe('which roles are scoped', () => {
    it('restricts caretakers, accountants and tenants', () => {
      expect(PropertyScopeService.isScoped(['CARETAKER'])).toBe(true);
      expect(PropertyScopeService.isScoped(['ACCOUNTANT'])).toBe(true);
      expect(PropertyScopeService.isScoped(['TENANT'])).toBe(true);
    });

    it('does not restrict owners, managers or super admins', () => {
      expect(PropertyScopeService.isScoped(['PROPERTY_OWNER'])).toBe(false);
      expect(PropertyScopeService.isScoped(['PROPERTY_MANAGER'])).toBe(false);
      expect(PropertyScopeService.isScoped(['SUPER_ADMIN'])).toBe(false);
    });

    it('does not restrict someone who also holds an unrestricted role', () => {
      // A caretaker who is also a manager manages the whole portfolio.
      expect(PropertyScopeService.isScoped(['CARETAKER', 'PROPERTY_MANAGER'])).toBe(false);
    });

    it('does not restrict a user with no roles at all', () => {
      // Such a user holds no permissions either, so every route refuses them
      // before scope is ever consulted.
      expect(PropertyScopeService.isScoped([])).toBe(false);
    });
  });

  describe('query fragments', () => {
    it('adds no filter for an unrestricted caller', () => {
      const service = serviceWithScope(null);
      expect(service.where()).toEqual({});
      expect(service.whereProperty()).toEqual({});
      expect(service.isRestricted).toBe(false);
    });

    it('filters to the assigned properties', () => {
      const service = serviceWithScope(['p1', 'p2']);
      expect(service.where()).toEqual({ propertyId: { in: ['p1', 'p2'] } });
      expect(service.whereProperty()).toEqual({ id: { in: ['p1', 'p2'] } });
      expect(service.isRestricted).toBe(true);
    });

    it('filters to NOTHING when a scoped user has no assignments', () => {
      // The dangerous bug this guards against: an empty list being treated as
      // "no filter" rather than "no access".
      const service = serviceWithScope([]);
      expect(service.where()).toEqual({ propertyId: { in: [] } });
      expect(service.whereProperty()).toEqual({ id: { in: [] } });
      expect(service.isRestricted).toBe(true);
    });
  });

  describe('assertProperty', () => {
    it('allows any property for an unrestricted caller', () => {
      expect(() => serviceWithScope(null).assertProperty('anything')).not.toThrow();
    });

    it('allows an assigned property', () => {
      expect(() => serviceWithScope(['p1']).assertProperty('p1')).not.toThrow();
    });

    it('reports an unassigned property as not found, not as forbidden', () => {
      // Telling a caretaker that a property exists but is not theirs is more
      // than they should know.
      expect(() => serviceWithScope(['p1']).assertProperty('p2')).toThrow(NotFoundError);
    });

    it('refuses everything when a scoped user has no assignments', () => {
      expect(() => serviceWithScope([]).assertProperty('p1')).toThrow(NotFoundError);
    });

    it('names the entity being looked for', () => {
      expect(() => serviceWithScope([]).assertProperty('p1', 'Unit')).toThrow('Unit not found.');
    });
  });
});
