import { Global, Module } from '@nestjs/common';
import { PropertyScopeService } from './property-scope.service';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { TenantContextService } from './tenant-context.service';

@Global()
@Module({
  providers: [TenantContextService, TenantContextMiddleware, PropertyScopeService],
  exports: [TenantContextService, TenantContextMiddleware, PropertyScopeService],
})
export class TenancyModule {}
