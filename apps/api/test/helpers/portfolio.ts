import type { NestExpressApplication } from '@nestjs/platform-express';
import { type SignedIn, authed } from './api-client';

/** Fixtures so the portfolio specs read as behaviour rather than plumbing. */

export async function createProperty(
  app: NestExpressApplication,
  session: SignedIn,
  overrides: Record<string, unknown> = {},
) {
  const response = await authed(app, session)
    .post('/properties')
    .send({
      name: `Property ${Math.random().toString(36).slice(2, 8)}`,
      propertyType: 'APARTMENT',
      city: 'Nairobi',
      ...overrides,
    })
    .expect(201);

  return response.body as { id: string; name: string; unitCount: number; buildingCount: number };
}

export async function createBuilding(
  app: NestExpressApplication,
  session: SignedIn,
  propertyId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await authed(app, session)
    .post('/buildings')
    .send({
      propertyId,
      name: `Block ${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      floors: 3,
      ...overrides,
    })
    .expect(201);

  return response.body as { id: string; name: string; propertyId: string; unitCount: number };
}

export async function createUnit(
  app: NestExpressApplication,
  session: SignedIn,
  propertyId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await authed(app, session)
    .post('/units')
    .send({
      propertyId,
      unitNumber: `A${Math.floor(Math.random() * 100000)}`,
      unitType: 'ONE_BEDROOM',
      monthlyRent: '32000.00',
      securityDeposit: '32000.00',
      ...overrides,
    })
    .expect(201);

  return response.body as {
    id: string;
    unitNumber: string;
    monthlyRent: string;
    securityDeposit: string;
    status: string;
    buildingId: string | null;
  };
}

export async function createTenant(
  app: NestExpressApplication,
  session: SignedIn,
  overrides: Record<string, unknown> = {},
) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const response = await authed(app, session)
    .post('/tenants')
    .send({
      fullName: `Tenant ${suffix}`,
      phone: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
      ...overrides,
    })
    .expect(201);

  return response.body as { id: string; fullName: string; isActive: boolean };
}

export async function createLease(
  app: NestExpressApplication,
  session: SignedIn,
  input: { tenantId: string; unitId: string } & Record<string, unknown>,
) {
  const response = await authed(app, session)
    .post('/leases')
    .send({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      dueDay: 5,
      ...input,
    })
    .expect(201);

  return response.body as {
    id: string;
    status: string;
    monthlyRent: string;
    securityDeposit: string;
    depositPaid: string;
    daysUntilExpiry: number | null;
  };
}
