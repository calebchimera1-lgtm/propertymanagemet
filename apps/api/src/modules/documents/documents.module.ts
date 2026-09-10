import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfig } from '@/config/app.config';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * Memory storage, not disk.
 *
 * The validation chain has to read the real first bytes before anything is
 * written anywhere, and multer's disk engine would put an unvalidated file on
 * the filesystem first. The size limit here is a second line of defence — the
 * validator checks the buffer length again — but it is the one that stops a
 * huge upload before it is fully buffered.
 */
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        limits: { fileSize: config.maxUploadBytes, files: 1 },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
