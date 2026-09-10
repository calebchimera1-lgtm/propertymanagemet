import { Global, Module } from '@nestjs/common';
import { ConsoleEmailProvider } from './email/console.email-provider';
import { EMAIL_PROVIDER } from './email/email-provider.interface';
import { FILE_STORAGE_PROVIDER } from './storage/file-storage.interface';
import { LocalFileStorageProvider } from './storage/local.file-storage';

/**
 * Binds provider ports to their Version 1 adapters. Swapping an adapter is a
 * change here plus an environment variable — never a change in a domain module.
 */
@Global()
@Module({
  providers: [
    { provide: EMAIL_PROVIDER, useClass: ConsoleEmailProvider },
    LocalFileStorageProvider,
    { provide: FILE_STORAGE_PROVIDER, useExisting: LocalFileStorageProvider },
  ],
  exports: [EMAIL_PROVIDER, FILE_STORAGE_PROVIDER, LocalFileStorageProvider],
})
export class ProvidersModule {}
