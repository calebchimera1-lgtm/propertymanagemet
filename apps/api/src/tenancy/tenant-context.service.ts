import { Injectable } from '@nestjs/common';
import { TenantContextMissingError } from '@/common/errors/domain.errors';
import { type AuthContext, type RequestStore, tenantStorage } from './tenant-context';

@Injectable()
export class TenantContextService {
  /** Binds a fresh store to the request and everything it awaits. */
  run<T>(store: RequestStore, fn: () => T): T {
    return tenantStorage.run(store, fn);
  }

  store(): RequestStore | undefined {
    return tenantStorage.getStore();
  }

  /** Called by the auth guard once the session has been resolved. */
  setAuth(auth: AuthContext): void {
    const store = tenantStorage.getStore();
    if (store) store.auth = auth;
  }

  /** The authenticated caller, or undefined on a public route. */
  get(): AuthContext | undefined {
    return tenantStorage.getStore()?.auth;
  }

  /**
   * The authenticated caller, or a hard failure.
   *
   * The tenant-scoped Prisma client calls this: a tenant query with no known
   * tenant is a bug, and failing loudly beats answering broadly.
   */
  getOrThrow(): AuthContext {
    const auth = tenantStorage.getStore()?.auth;
    if (!auth) throw new TenantContextMissingError();
    return auth;
  }

  get organizationId(): string {
    return this.getOrThrow().organizationId;
  }

  get userId(): string {
    return this.getOrThrow().userId;
  }

  get requestId(): string {
    return tenantStorage.getStore()?.requestId ?? 'unknown';
  }

  hasPermission(permission: string): boolean {
    const auth = this.get();
    return auth ? (auth.permissions as string[]).includes(permission) : false;
  }
}
