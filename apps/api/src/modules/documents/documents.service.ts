import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DocumentEntityType, Prisma } from '@pm/database';
import { paginated } from '@/common/dto/pagination.dto';
import { DomainError, NotFoundError } from '@/common/errors/domain.errors';
import { AppConfig } from '@/config/app.config';
import { AUDIT_ACTIONS, AuditLogService } from '@/modules/audit-logs/audit-log.service';
import {
  FILE_STORAGE_PROVIDER,
  type FileStorageProvider,
} from '@/providers/storage/file-storage.interface';
import {
  UploadRejectedError,
  type UploadCandidate,
  validateUpload,
} from '@/providers/storage/file-validation';
import { InjectScopedPrisma } from '@/prisma/prisma.module';
import type { ScopedPrismaClient } from '@/prisma/tenant-scope.extension';
import { PropertyScopeService } from '@/tenancy/property-scope.service';
import { TenantContextService } from '@/tenancy/tenant-context.service';
import type { ListDocumentsQueryDto, UploadDocumentDto } from './dto/document.dto';

const DOCUMENT_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  name: true,
  originalFilename: true,
  mimeType: true,
  sizeBytes: true,
  checksum: true,
  uploadedById: true,
  createdAt: true,
  uploadedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.DocumentSelect;

/**
 * `storageKey` is absent from the select on purpose.
 *
 * It is an internal address, not information a client needs, and returning it
 * would invite someone to try building a URL from it. The only way to a byte of
 * a document is GET /documents/:id/download, which authorizes first.
 */
type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectScopedPrisma() private readonly db: ScopedPrismaClient,
    @Inject(FILE_STORAGE_PROVIDER) private readonly storage: FileStorageProvider,
    private readonly scope: PropertyScopeService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Confirms the linked record exists inside the caller's organization AND
   * inside their property scope.
   *
   * The scope half matters: without it, a caretaker assigned to one estate
   * could attach a document to — and then read documents on — a lease in an
   * estate they cannot open. Every branch resolves through the scoped client,
   * so "not yours" and "does not exist" are the same 404.
   */
  private async assertEntity(
    entityType: DocumentEntityType,
    entityId: string | undefined,
  ): Promise<void> {
    if (entityType === 'ORGANIZATION') return;

    if (!entityId) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `A ${entityType.toLowerCase()} document must say which record it belongs to.`,
        422,
        [{ field: 'entityId', message: 'Choose the record this document belongs to.' }],
      );
    }

    const scope = this.scope.where();

    switch (entityType) {
      case 'PROPERTY': {
        this.scope.assertProperty(entityId, 'Property');
        const found = await this.db.property.count({ where: { id: entityId } });
        if (found === 0) throw new NotFoundError('Property');
        return;
      }
      case 'BUILDING': {
        const found = await this.db.building.count({ where: { id: entityId, ...scope } });
        if (found === 0) throw new NotFoundError('Building');
        return;
      }
      case 'UNIT': {
        const found = await this.db.unit.count({ where: { id: entityId, ...scope } });
        if (found === 0) throw new NotFoundError('Unit');
        return;
      }
      case 'TENANT': {
        // A tenant belongs to the organization, not a property, so scope
        // reaches them through their leases — the same rule the tenant list uses.
        const found = await this.db.tenant.count({
          where: {
            id: entityId,
            ...(this.scope.where().propertyId ? { leases: { some: scope } } : {}),
          },
        });
        if (found === 0) throw new NotFoundError('Tenant');
        return;
      }
      case 'LEASE': {
        const found = await this.db.lease.count({ where: { id: entityId, ...scope } });
        if (found === 0) throw new NotFoundError('Lease');
        return;
      }
      case 'EXPENSE': {
        const found = await this.db.expense.count({ where: { id: entityId, ...scope } });
        if (found === 0) throw new NotFoundError('Expense');
        return;
      }
      case 'MAINTENANCE': {
        const found = await this.db.maintenanceRequest.count({
          where: { id: entityId, ...scope },
        });
        if (found === 0) throw new NotFoundError('Maintenance request');
        return;
      }
      default: {
        throw new NotFoundError('Record');
      }
    }
  }

  async list(query: ListDocumentsQueryDto) {
    // Filtering by an entity re-runs the same ownership and scope check as
    // attaching to it, so a document list cannot be used to probe for records.
    if (query.entityType && query.entityId) {
      await this.assertEntity(query.entityType, query.entityId);
    }

    const where: Prisma.DocumentWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { originalFilename: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.document.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder },
        select: DOCUMENT_SELECT,
      }),
      this.db.document.count({ where }),
    ]);

    return paginated(rows, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<DocumentRow> {
    const document = await this.db.document.findFirst({ where: { id }, select: DOCUMENT_SELECT });
    if (!document) throw new NotFoundError('Document');

    // The row is in the caller's organization, but its linked record may be
    // outside their property scope — check that too before handing it over.
    await this.assertEntity(document.entityType, document.entityId ?? undefined);
    return document;
  }

  async upload(dto: UploadDocumentDto, file: UploadCandidate | undefined) {
    const auth = this.tenant.getOrThrow();

    if (!file) {
      throw new DomainError('VALIDATION_FAILED', 'No file was uploaded.', 422, [
        { field: 'file', message: 'Choose a file to upload.' },
      ]);
    }

    // Authorize the destination BEFORE touching the bytes: an upload to a
    // record the caller cannot see should not even be validated, let alone
    // written to disk.
    await this.assertEntity(dto.entityType, dto.entityId);

    let validated;
    try {
      validated = validateUpload(file, {
        organizationId: auth.organizationId,
        maxBytes: this.config.maxUploadBytes,
      });
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        // A rejected upload is worth recording: repeated content-mismatch
        // failures from one account are what an attempted upload attack looks
        // like from the inside.
        await this.audit.record({
          organizationId: auth.organizationId,
          userId: auth.userId,
          actorEmail: auth.email,
          action: AUDIT_ACTIONS.DOCUMENT_UPLOAD_REJECTED,
          entityType: 'Document',
          metadata: { reason: error.reason, declaredType: file.mimetype },
        });
        throw new DomainError(error.reason, error.message, 422, [
          { field: 'file', message: error.message },
        ]);
      }
      throw error;
    }

    // Bytes first, row second. A stored object with no row is a harmless
    // orphan the cleanup job sweeps; a row with no object is a broken download
    // the user sees.
    await this.storage.put(validated.storageKey, file.buffer, validated.mimeType);

    let document: DocumentRow;
    try {
      document = await this.db.document.create({
        data: {
          organizationId: auth.organizationId,
          entityType: dto.entityType,
          entityId: dto.entityType === 'ORGANIZATION' ? null : (dto.entityId ?? null),
          name: dto.name ?? validated.displayFilename,
          originalFilename: validated.displayFilename,
          storageKey: validated.storageKey,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          checksum: validated.checksum,
          uploadedById: auth.userId,
        },
        select: DOCUMENT_SELECT,
      });
    } catch (error) {
      // Do not leave the object behind if the row could not be written.
      await this.storage.delete(validated.storageKey).catch(() => undefined);
      throw error;
    }

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
      entityType: 'Document',
      entityId: document.id,
      metadata: {
        entityType: dto.entityType,
        entityId: dto.entityId ?? null,
        sizeBytes: validated.sizeBytes,
        mimeType: validated.mimeType,
      },
    });

    return document;
  }

  /**
   * Resolves a document to a readable stream, after the full authorization
   * chain. The controller sets the response headers; this returns nothing that
   * would let a caller reach the object any other way.
   */
  async openForDownload(id: string) {
    const auth = this.tenant.getOrThrow();
    const document = await this.findOne(id);

    const row = await this.db.document.findFirstOrThrow({
      where: { id },
      select: { storageKey: true },
    });

    const stream = await this.storage.get(row.storageKey).catch(() => {
      // The metadata says it exists but the object does not: a restored
      // database against an empty volume, or a manual deletion. Say so rather
      // than streaming an empty file that looks like a corrupt document.
      this.logger.error(`Document ${id} has no stored object at its key`);
      throw new NotFoundError('Document file');
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.DOCUMENT_DOWNLOADED,
      entityType: 'Document',
      entityId: id,
    });

    return { document, stream };
  }

  async remove(id: string): Promise<void> {
    const auth = this.tenant.getOrThrow();
    await this.findOne(id);

    const row = await this.db.document.findFirstOrThrow({
      where: { id },
      select: { storageKey: true, name: true },
    });

    // Row first, then the object: if the delete of the object fails, the
    // document is already unreachable and the orphan is cleanable. The reverse
    // order would leave a row pointing at nothing.
    await this.db.document.delete({ where: { id } });
    await this.storage.delete(row.storageKey).catch((error: Error) => {
      this.logger.error(`Orphaned object ${row.storageKey}: ${error.message}`);
    });

    await this.audit.record({
      organizationId: auth.organizationId,
      userId: auth.userId,
      actorEmail: auth.email,
      action: AUDIT_ACTIONS.DOCUMENT_DELETED,
      entityType: 'Document',
      entityId: id,
      metadata: { name: row.name },
    });
  }
}
