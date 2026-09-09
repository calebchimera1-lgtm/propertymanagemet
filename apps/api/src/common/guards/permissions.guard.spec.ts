import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AUTHENTICATED_ONLY_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '@/common/decorators';
import { ForbiddenError } from '@/common/errors/domain.errors';
import type { AuthContext } from '@/tenancy/tenant-context';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const auth = (permissions: string[]): AuthContext => ({
    sessionId: 'session-1',
    userId: 'user-1',
    organizationId: 'org-1',
    email: 'user@example.test',
    roles: ['PROPERTY_MANAGER'],
    permissions: permissions as AuthContext['permissions'],
    scopedPropertyIds: null,
  });

  function contextWith(request: unknown): ExecutionContext {
    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function guardWith(metadata: Record<string, unknown>): PermissionsGuard {
    const reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) => metadata[key as string] as never);
    return new PermissionsGuard(reflector);
  }

  it('allows a public route with no session', () => {
    const guard = guardWith({ [IS_PUBLIC_KEY]: true });
    expect(guard.canActivate(contextWith({}))).toBe(true);
  });

  it('denies an authenticated route with no session', () => {
    const guard = guardWith({});
    expect(() => guard.canActivate(contextWith({}))).toThrow(ForbiddenError);
  });

  it('allows a route marked @AuthenticatedOnly for any signed-in user', () => {
    const guard = guardWith({ [AUTHENTICATED_ONLY_KEY]: true });
    expect(guard.canActivate(contextWith({ auth: auth([]) }))).toBe(true);
  });

  it('allows when the caller holds the required permission', () => {
    const guard = guardWith({ [PERMISSIONS_KEY]: ['properties.view'] });
    expect(guard.canActivate(contextWith({ auth: auth(['properties.view']) }))).toBe(true);
  });

  it('denies when the caller is missing one of several required permissions', () => {
    const guard = guardWith({ [PERMISSIONS_KEY]: ['properties.view', 'properties.update'] });
    expect(() =>
      guard.canActivate(contextWith({ auth: auth(['properties.view']) })),
    ).toThrow(ForbiddenError);
  });

  it('DENIES a route that declares no policy at all', () => {
    // Forgetting to declare access must never mean "any signed-in user may do
    // this". This is the fail-closed default the whole guard exists for.
    const guard = guardWith({});
    expect(() =>
      guard.canActivate(contextWith({ auth: auth(['properties.view']) })),
    ).toThrow(/No access policy is declared/);
  });

  it('denies a route declaring an empty permission array', () => {
    const guard = guardWith({ [PERMISSIONS_KEY]: [] });
    expect(() => guard.canActivate(contextWith({ auth: auth([]) }))).toThrow(ForbiddenError);
  });
});
