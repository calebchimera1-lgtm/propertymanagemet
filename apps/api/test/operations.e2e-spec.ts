import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '@/prisma/prisma.service';
import {
  BASE,
  STRONG_PASSWORD,
  type SignedIn,
  authed,
  registerOrganization,
  signIn,
} from './helpers/api-client';
import { PDF_BYTES, PNG_BYTES, download, upload } from './helpers/operations';
import { createProperty, createUnit } from './helpers/portfolio';
import { createTestApp, resetDatabase } from './helpers/test-app';

/**
 * Phase 5 end to end: the day-to-day operations layer.
 *
 * The document tests are the sharpest in the project. Every one of them is an
 * attempt to get a byte out of the system without going through the
 * authorization chain, or to get a file in that should never be stored.
 */
describe('Operations (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let owner: SignedIn;
  let propertyId: string;
  let unitId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    owner = await registerOrganization(app, {
      organizationName: 'ABC Properties',
      fullName: 'Amina Ochieng',
      email: 'owner@abc.test',
      password: STRONG_PASSWORD,
    });
    const property = await createProperty(app, owner, { name: 'Sunrise Estate' });
    propertyId = property.id;
    const unit = await createUnit(app, owner, propertyId, { unitNumber: 'A1' });
    unitId = unit.id;
  });

  async function raiseRequest(overrides: Record<string, unknown> = {}) {
    const response = await authed(app, owner)
      .post('/maintenance')
      .send({
        propertyId,
        unitId,
        title: 'Kitchen tap will not close',
        description: 'Dripping since Tuesday.',
        priority: 'HIGH',
        ...overrides,
      })
      .expect(201);
    return response.body as { id: string; status: string; updates: unknown[] };
  }

  describe('maintenance', () => {
    it('raises a request with its first timeline entry', async () => {
      const created = await raiseRequest();
      expect(created.status).toBe('PENDING');
      expect(created.updates).toHaveLength(1);
    });

    it('walks the workflow and records every step on the timeline', async () => {
      const created = await raiseRequest();

      await authed(app, owner)
        .post(`/maintenance/${created.id}/assign`)
        .send({ assignedToId: owner.userId })
        .expect(201);
      await authed(app, owner)
        .post(`/maintenance/${created.id}/status`)
        .send({ status: 'IN_PROGRESS', note: 'Plumber on site.' })
        .expect(201);
      const done = await authed(app, owner)
        .post(`/maintenance/${created.id}/status`)
        .send({ status: 'COMPLETED', actualCost: '5200.00' })
        .expect(201);

      expect(done.body.status).toBe('COMPLETED');
      expect(done.body.completedAt).not.toBeNull();
      expect(done.body.actualCost).toBe('5200.00');
      expect(done.body.updates).toHaveLength(4);

      const statuses = done.body.updates.map((update: { toStatus: string }) => update.toStatus);
      expect(statuses).toEqual(['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']);
    });

    it('refuses a jump straight to completed', async () => {
      const created = await raiseRequest();
      const response = await authed(app, owner)
        .post(`/maintenance/${created.id}/status`)
        .send({ status: 'COMPLETED' })
        .expect(409);
      expect(response.body.message).toMatch(/cannot move straight to completed/);
    });

    it('refuses to reopen a finished job', async () => {
      const created = await raiseRequest();
      await authed(app, owner)
        .post(`/maintenance/${created.id}/status`)
        .send({ status: 'IN_PROGRESS' })
        .expect(201);
      await authed(app, owner)
        .post(`/maintenance/${created.id}/status`)
        .send({ status: 'COMPLETED' })
        .expect(201);

      const reopen = await authed(app, owner)
        .post(`/maintenance/${created.id}/status`)
        .send({ status: 'IN_PROGRESS' })
        .expect(409);
      expect(reopen.body.message).toMatch(/Raise a new request/);

      // Editing is closed too, for the same reason.
      await authed(app, owner)
        .patch(`/maintenance/${created.id}`)
        .send({ title: 'Rewriting history' })
        .expect(409);
    });

    it('keeps completedAt and COMPLETED in step, even against a direct write', async () => {
      const created = await raiseRequest();
      // The database refuses the contradiction whatever the application does.
      await expect(
        prisma.maintenanceRequest.update({
          where: { id: created.id },
          data: { status: 'COMPLETED' },
        }),
      ).rejects.toThrow(/MaintenanceRequest_completed_has_date/);
    });

    it('refuses a negative cost at the database level', async () => {
      const created = await raiseRequest();
      await expect(
        prisma.maintenanceRequest.update({
          where: { id: created.id },
          data: { actualCost: '-1.00' },
        }),
      ).rejects.toThrow(/MaintenanceRequest_costs_non_negative/);
    });

    it('unassigning an assigned request moves it back to pending', async () => {
      const created = await raiseRequest();
      await authed(app, owner)
        .post(`/maintenance/${created.id}/assign`)
        .send({ assignedToId: owner.userId })
        .expect(201);

      const cleared = await authed(app, owner)
        .post(`/maintenance/${created.id}/assign`)
        .send({ assignedToId: null })
        .expect(201);
      expect(cleared.body.status).toBe('PENDING');
      expect(cleared.body.assignedToId).toBeNull();
    });

    it('counts open work for the board', async () => {
      await raiseRequest({ priority: 'URGENT' });
      const second = await raiseRequest({ title: 'Broken lock' });
      await authed(app, owner)
        .post(`/maintenance/${second.id}/status`)
        .send({ status: 'CANCELLED' })
        .expect(201);

      const summary = await authed(app, owner).get('/maintenance/summary').expect(200);
      expect(summary.body.counts.PENDING).toBe(1);
      expect(summary.body.counts.CANCELLED).toBe(1);
      expect(summary.body.urgentOpen).toBe(1);
    });
  });

  describe('documents: what gets in', () => {
    it('stores a real PDF with a checksum and a generated key', async () => {
      const response = await upload(
        app,
        owner,
        { name: 'lease.pdf', bytes: PDF_BYTES, type: 'application/pdf' },
        { entityType: 'UNIT', entityId: unitId, name: 'Signed lease' },
      ).expect(201);

      expect(response.body.name).toBe('Signed lease');
      expect(response.body.checksum).toMatch(/^[0-9a-f]{64}$/);
      // The storage key is an internal address; returning it would invite
      // someone to try building a URL out of it.
      expect(response.body.storageKey).toBeUndefined();

      const stored = await prisma.document.findUniqueOrThrow({
        where: { id: response.body.id },
        select: { storageKey: true },
      });
      expect(stored.storageKey).toMatch(/^org\/[a-z0-9]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    });

    it('refuses a script wearing a PDF name', async () => {
      const response = await upload(
        app,
        owner,
        {
          name: 'invoice.pdf',
          bytes: Buffer.from('<?php system($_GET["c"]); ?>'),
          type: 'application/pdf',
        },
        { entityType: 'ORGANIZATION' },
      ).expect(422);

      expect(response.body.code).toBe('FILE_CONTENT_MISMATCH');
      expect(await prisma.document.count()).toBe(0);
    });

    it('refuses an SVG and an executable outright', async () => {
      await upload(
        app,
        owner,
        { name: 'x.svg', bytes: Buffer.from('<svg onload="alert(1)"/>'), type: 'image/svg+xml' },
        { entityType: 'ORGANIZATION' },
      ).expect(422);

      await upload(
        app,
        owner,
        { name: 'x.exe', bytes: Buffer.from('MZ'), type: 'application/x-msdownload' },
        { entityType: 'ORGANIZATION' },
      ).expect(422);

      expect(await prisma.document.count()).toBe(0);
    });

    it('refuses a declared type that contradicts the extension', async () => {
      await upload(
        app,
        owner,
        { name: 'photo.png', bytes: PNG_BYTES, type: 'application/pdf' },
        { entityType: 'ORGANIZATION' },
      ).expect(422);
    });

    it('never lets a filename reach the storage path', async () => {
      const response = await upload(
        app,
        owner,
        { name: '../../../etc/passwd.pdf', bytes: PDF_BYTES, type: 'application/pdf' },
        { entityType: 'ORGANIZATION' },
      ).expect(201);

      // Accepted, but neutralised: the traversal is gone from both the display
      // name and the generated key.
      expect(response.body.originalFilename).toBe('passwd.pdf');
      const stored = await prisma.document.findUniqueOrThrow({
        where: { id: response.body.id },
        select: { storageKey: true },
      });
      expect(stored.storageKey).not.toContain('..');
      expect(stored.storageKey).not.toContain('passwd');
    });

    it('records a rejected upload in the audit trail', async () => {
      await upload(
        app,
        owner,
        { name: 'evil.pdf', bytes: Buffer.from('<script>alert(1)</script>'), type: 'application/pdf' },
        { entityType: 'ORGANIZATION' },
      ).expect(422);

      // Repeated content mismatches from one account is what an attempted
      // upload attack looks like from the inside.
      const rejected = await prisma.auditLog.count({
        where: { action: 'DOCUMENT_UPLOAD_REJECTED' },
      });
      expect(rejected).toBe(1);
    });

    it('requires a record for anything but an organization document', async () => {
      await upload(
        app,
        owner,
        { name: 'lease.pdf', bytes: PDF_BYTES, type: 'application/pdf' },
        { entityType: 'UNIT' },
      ).expect(422);
    });

    it('refuses to attach a document to another organization’s record', async () => {
      const other = await registerOrganization(app, {
        organizationName: 'XYZ Estates',
        fullName: 'Brian Otieno',
        email: 'owner@xyz.test',
        password: STRONG_PASSWORD,
      });
      const foreignUnit = await createUnit(
        app,
        other,
        (await createProperty(app, other, { name: 'Westlands Court' })).id,
        { unitNumber: 'X1' },
      );

      await upload(
        app,
        owner,
        { name: 'lease.pdf', bytes: PDF_BYTES, type: 'application/pdf' },
        { entityType: 'UNIT', entityId: foreignUnit.id },
      ).expect(404);

      expect(await prisma.document.count()).toBe(0);
    });
  });

  describe('documents: what gets out', () => {
    let documentId: string;

    beforeEach(async () => {
      const response = await upload(
        app,
        owner,
        { name: 'lease.pdf', bytes: PDF_BYTES, type: 'application/pdf' },
        { entityType: 'UNIT', entityId: unitId },
      ).expect(201);
      documentId = response.body.id;
    });

    it('streams the exact bytes back, as an attachment that cannot execute', async () => {
      const response = await download(app, owner, documentId).expect(200);

      expect(response.headers['content-disposition']).toMatch(/^attachment;/);
      // These two are what stop an uploaded file becoming an XSS in the app origin.
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toMatch(/sandbox/);
      expect(Buffer.from(response.body)).toEqual(PDF_BYTES);
    });

    it('refuses an anonymous download', async () => {
      await download(app, null, documentId).expect(401);
    });

    it('refuses another organization’s download and its metadata alike', async () => {
      const other = await registerOrganization(app, {
        organizationName: 'XYZ Estates',
        fullName: 'Brian Otieno',
        email: 'owner@xyz.test',
        password: STRONG_PASSWORD,
      });

      // 404 both times: a 403 on the metadata would confirm the document exists.
      await authed(app, other).get(`/documents/${documentId}`).expect(404);
      await download(app, other, documentId).expect(404);
    });

    it('deletes the row and the stored object together', async () => {
      const stored = await prisma.document.findUniqueOrThrow({
        where: { id: documentId },
        select: { storageKey: true },
      });

      await authed(app, owner).delete(`/documents/${documentId}`).expect(204);

      expect(await prisma.document.count({ where: { id: documentId } })).toBe(0);
      await download(app, owner, documentId).expect(404);

      const { existsSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const root = resolve(process.env.STORAGE_LOCAL_PATH ?? './storage/uploads');
      expect(existsSync(resolve(root, stored.storageKey))).toBe(false);
    });
  });

  describe('staff', () => {
    /**
     * A platform super admin, created in the database rather than through the
     * API — which refuses to grant the role, on purpose.
     */
    async function createSuperAdmin(): Promise<SignedIn> {
      const argon2 = await import('argon2');
      const passwordHash = await argon2.hash(STRONG_PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 8192,
        timeCost: 2,
        parallelism: 1,
      });
      const user = await prisma.user.create({
        data: {
          organizationId: owner.organizationId,
          email: 'platform@abc.test',
          passwordHash,
          fullName: 'Platform Admin',
          status: 'ACTIVE',
        },
      });
      const role = await prisma.role.findFirstOrThrow({
        where: { name: 'SUPER_ADMIN', organizationId: null },
      });
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id, organizationId: owner.organizationId },
      });
      return signIn(app, 'platform@abc.test', STRONG_PASSWORD);
    }

    async function invite(overrides: Record<string, unknown> = {}) {
      const response = await authed(app, owner)
        .post('/staff')
        .send({
          email: 'caretaker@abc.test',
          fullName: 'Peter Kamau',
          role: 'CARETAKER',
          ...overrides,
        })
        .expect(201);
      return response.body as {
        staff: { id: string; email: string; status: string; properties: unknown[] | null };
        invite: { url: string };
      };
    }

    it('creates an invited account and returns a one-time link', async () => {
      const result = await invite({ propertyIds: [propertyId] });

      expect(result.staff.status).toBe('INVITED');
      expect(result.invite.url).toContain('/reset-password?token=');
      expect(result.staff.properties).toHaveLength(1);

      // The link is never readable again from anywhere.
      const reread = await authed(app, owner).get(`/staff/${result.staff.id}`).expect(200);
      expect(reread.body.invite).toBeUndefined();

      // And it is not sitting in the audit trail either.
      const token = new URL(result.invite.url).searchParams.get('token');
      const audit = await prisma.auditLog.findMany({ where: { action: 'STAFF_INVITED' } });
      expect(JSON.stringify(audit)).not.toContain(token);
    });

    it('cannot be signed into until the invite is accepted', async () => {
      const result = await invite();

      // The stored hash is of a random secret nobody has ever seen.
      await request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: result.staff.email, password: STRONG_PASSWORD })
        .expect(401);

      const token = new URL(result.invite.url).searchParams.get('token');
      await request(app.getHttpServer())
        .post(`${BASE}/auth/reset-password`)
        .send({ token, password: STRONG_PASSWORD })
        .expect(200);

      // Accepting the invite activates the account — without this the whole
      // flow would dead-end at a 403.
      const staff = await signIn(app, result.staff.email, STRONG_PASSWORD);
      const me = await authed(app, staff).get('/auth/me').expect(200);
      expect(me.body.roles).toEqual(['CARETAKER']);
    });

    it('refuses to grant SUPER_ADMIN', async () => {
      await authed(app, owner)
        .post('/staff')
        .send({ email: 'escalate@abc.test', fullName: 'Escalation', role: 'SUPER_ADMIN' })
        .expect(400);
    });

    it('refuses to let anyone change their own role or deactivate themselves', async () => {
      await authed(app, owner)
        .patch(`/staff/${owner.userId}`)
        .send({ role: 'CARETAKER' })
        .expect(403);
      await authed(app, owner).post(`/staff/${owner.userId}/deactivate`).expect(403);
    });

    it('refuses to strand an organization with no active owner', async () => {
      /*
       * Only owners and platform admins hold staff.update, and nobody may act
       * on their own account — so the one caller who can reach the last active
       * owner is a super admin. Created directly in the database, because the
       * API deliberately refuses to grant that role (tested above).
       */
      const admin = await createSuperAdmin();

      const deactivate = await authed(app, admin).post(`/staff/${owner.userId}/deactivate`);
      expect(deactivate.status).toBe(409);
      expect(deactivate.body.message).toMatch(/only active owner/);

      const demote = await authed(app, admin)
        .patch(`/staff/${owner.userId}`)
        .send({ role: 'PROPERTY_MANAGER' });
      expect(demote.status).toBe(409);

      await authed(app, admin).delete(`/staff/${owner.userId}`).expect(409);

      // The owner is untouched by all three attempts.
      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
      expect(unchanged.status).toBe('ACTIVE');
    });

    it('lets a manager see staff but change nothing about them', async () => {
      const manager = await invite({ email: 'manager@abc.test', role: 'PROPERTY_MANAGER' });
      const token = new URL(manager.invite.url).searchParams.get('token');
      await request(app.getHttpServer())
        .post(`${BASE}/auth/reset-password`)
        .send({ token, password: STRONG_PASSWORD })
        .expect(200);
      const asManager = await signIn(app, 'manager@abc.test', STRONG_PASSWORD);

      await authed(app, asManager).get('/staff').expect(200);
      // staff.view without staff.update: managing people is an owner's job.
      await authed(app, asManager).post(`/staff/${owner.userId}/deactivate`).expect(403);
      await authed(app, asManager)
        .post('/staff')
        .send({ email: 'x@abc.test', fullName: 'X', role: 'CARETAKER' })
        .expect(403);
    });

    it('allows demoting an owner while another active owner remains', async () => {
      // The counterpart: the rule protects the last one, not every one.
      const second = await invite({ email: 'owner2@abc.test', role: 'PROPERTY_OWNER' });
      const token = new URL(second.invite.url).searchParams.get('token');
      await request(app.getHttpServer())
        .post(`${BASE}/auth/reset-password`)
        .send({ token, password: STRONG_PASSWORD })
        .expect(200);

      const demoted = await authed(app, owner)
        .patch(`/staff/${second.staff.id}`)
        .send({ role: 'PROPERTY_MANAGER' })
        .expect(200);
      expect(demoted.body.roles).toEqual(['PROPERTY_MANAGER']);
    });

    it('replaces property assignments as a whole set, and empty means nothing', async () => {
      const second = await createProperty(app, owner, { name: 'Second Estate' });
      const result = await invite({ propertyIds: [propertyId] });

      const both = await authed(app, owner)
        .put(`/staff/${result.staff.id}/properties`)
        .send({ propertyIds: [propertyId, second.id] })
        .expect(200);
      expect(both.body.properties).toHaveLength(2);

      const none = await authed(app, owner)
        .put(`/staff/${result.staff.id}/properties`)
        .send({ propertyIds: [] })
        .expect(200);
      expect(none.body.properties).toHaveLength(0);
    });

    it('refuses to assign properties to an unrestricted role', async () => {
      const manager = await invite({ email: 'manager@abc.test', role: 'PROPERTY_MANAGER' });
      // A manager already sees everything; a specific list would be misleading.
      await authed(app, owner)
        .put(`/staff/${manager.staff.id}/properties`)
        .send({ propertyIds: [propertyId] })
        .expect(422);
    });

    it('deactivation ends every open session immediately', async () => {
      const result = await invite();
      const token = new URL(result.invite.url).searchParams.get('token');
      await request(app.getHttpServer())
        .post(`${BASE}/auth/reset-password`)
        .send({ token, password: STRONG_PASSWORD })
        .expect(200);
      const staff = await signIn(app, result.staff.email, STRONG_PASSWORD);
      await authed(app, staff).get('/auth/me').expect(200);

      await authed(app, owner).post(`/staff/${result.staff.id}/deactivate`).expect(200);

      // Not "at cookie expiry" — now.
      await authed(app, staff).get('/auth/me').expect(401);
    });
  });

  describe('notifications', () => {
    it('reaches only the intended user, and only their own rows', async () => {
      const created = await raiseRequest();
      const result = await authed(app, owner)
        .post('/staff')
        .send({ email: 'caretaker@abc.test', fullName: 'Peter Kamau', role: 'CARETAKER' })
        .expect(201);

      await authed(app, owner)
        .post(`/maintenance/${created.id}/assign`)
        .send({ assignedToId: result.body.staff.id })
        .expect(201);

      const assigneeRows = await prisma.notification.count({
        where: { userId: result.body.staff.id, type: 'MAINTENANCE_UPDATED' },
      });
      expect(assigneeRows).toBe(1);

      const own = await authed(app, owner).get('/notifications').expect(200);
      expect(
        own.body.data.every((row: { entityId: string }) => row.entityId !== undefined),
      ).toBe(true);
      // The owner assigned it; the alert went to the assignee, not back to them.
      expect(
        own.body.data.filter((row: { type: string }) => row.type === 'MAINTENANCE_UPDATED'),
      ).toHaveLength(0);
    });

    it('collapses the same fact on the same day to one row', async () => {
      const created = await raiseRequest();
      const staff = await authed(app, owner)
        .post('/staff')
        .send({ email: 'caretaker@abc.test', fullName: 'Peter Kamau', role: 'CARETAKER' })
        .expect(201);

      // Assign, unassign, reassign: three actions, one fact.
      await authed(app, owner)
        .post(`/maintenance/${created.id}/assign`)
        .send({ assignedToId: staff.body.staff.id })
        .expect(201);
      await authed(app, owner)
        .post(`/maintenance/${created.id}/assign`)
        .send({ assignedToId: null })
        .expect(201);
      await authed(app, owner)
        .post(`/maintenance/${created.id}/assign`)
        .send({ assignedToId: staff.body.staff.id })
        .expect(201);

      const rows = await prisma.notification.count({
        where: { userId: staff.body.staff.id, entityId: created.id },
      });
      expect(rows).toBe(1);
    });

    it('lets a user mark only their own notifications read', async () => {
      const staff = await authed(app, owner)
        .post('/staff')
        .send({ email: 'caretaker@abc.test', fullName: 'Peter Kamau', role: 'CARETAKER' })
        .expect(201);
      const created = await raiseRequest();
      await authed(app, owner)
        .post(`/maintenance/${created.id}/assign`)
        .send({ assignedToId: staff.body.staff.id })
        .expect(201);

      const theirs = await prisma.notification.findFirstOrThrow({
        where: { userId: staff.body.staff.id },
      });

      // The owner is in the same organization and still cannot touch it.
      await authed(app, owner).post(`/notifications/${theirs.id}/read`).expect(404);
      expect(
        (await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt,
      ).toBeNull();
    });

    it('reports an unread count for the topbar badge', async () => {
      const before = await authed(app, owner).get('/notifications/unread-count').expect(200);
      expect(typeof before.body.count).toBe('number');

      await authed(app, owner).post('/notifications/read-all').expect(200);
      const after = await authed(app, owner).get('/notifications/unread-count').expect(200);
      expect(after.body.count).toBe(0);
    });
  });

  describe('the audit trail', () => {
    it('records what happened and can be read back, newest first', async () => {
      await raiseRequest();

      const response = await authed(app, owner).get('/audit-logs').expect(200);
      expect(response.body.meta.total).toBeGreaterThan(0);

      const actions = response.body.data.map((row: { action: string }) => row.action);
      expect(actions).toContain('MAINTENANCE_CREATED');
      expect(actions[0]).toBe('MAINTENANCE_CREATED');
    });

    it('never returns an IP address or user agent', async () => {
      await raiseRequest();
      const response = await authed(app, owner).get('/audit-logs').expect(200);

      // Stored for an incident investigation; not surfaced as a staff list of
      // colleagues' IP addresses.
      for (const row of response.body.data) {
        expect(row.ipAddress).toBeUndefined();
        expect(row.userAgent).toBeUndefined();
      }
    });

    it('offers only actions that are actually present', async () => {
      await raiseRequest();
      const actions = await authed(app, owner).get('/audit-logs/actions').expect(200);
      expect(actions.body).toContain('MAINTENANCE_CREATED');
      expect(actions.body).not.toContain('PAYMENT_VOIDED');
    });

    it('has no write surface at all', async () => {
      // Not 403 — there is no such route. An audit trail an operator can edit
      // is not an audit trail.
      await authed(app, owner).post('/audit-logs').send({ action: 'FAKE' }).expect(404);
      await authed(app, owner).delete('/audit-logs/anything').expect(404);
    });

    it('is not readable by a role without the permission', async () => {
      const staff = await authed(app, owner)
        .post('/staff')
        .send({ email: 'caretaker@abc.test', fullName: 'Peter Kamau', role: 'CARETAKER' })
        .expect(201);
      const token = new URL(staff.body.invite.url).searchParams.get('token');
      await request(app.getHttpServer())
        .post(`${BASE}/auth/reset-password`)
        .send({ token, password: STRONG_PASSWORD })
        .expect(200);
      const caretaker = await signIn(app, staff.body.staff.email, STRONG_PASSWORD);

      await authed(app, caretaker).get('/audit-logs').expect(403);
    });
  });

  describe('authentication', () => {
    it('refuses every operations route without a session', async () => {
      for (const path of ['/maintenance', '/staff', '/documents', '/notifications', '/audit-logs']) {
        await request(app.getHttpServer()).get(`${BASE}${path}`).expect(401);
      }
    });

    it('refuses a maintenance write without the CSRF header', async () => {
      await authed(app, owner)
        .postWithoutCsrf('/maintenance')
        .send({ propertyId, title: 'No CSRF', description: 'Should be refused.' })
        .expect(403);

      expect(await prisma.maintenanceRequest.count()).toBe(0);
    });
  });
});
