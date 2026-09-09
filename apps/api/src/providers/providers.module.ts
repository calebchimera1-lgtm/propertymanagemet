import { Global, Module } from '@nestjs/common';
import { ConsoleEmailProvider } from './email/console.email-provider';
import { EMAIL_PROVIDER } from './email/email-provider.interface';

/**
 * Binds provider ports to their Version 1 adapters. Swapping an adapter is a
 * change here plus an environment variable — never a change in a domain module.
 */
@Global()
@Module({
  providers: [{ provide: EMAIL_PROVIDER, useClass: ConsoleEmailProvider }],
  exports: [EMAIL_PROVIDER],
})
export class ProvidersModule {}
