# Property Management SaaS

A multi-tenant property management platform for landlords, property owners, property managers and
businesses running portfolios of properties, buildings, units, tenants, leases, rent, payments,
expenses, maintenance, staff and documents.

> **Current status: blueprint under review.** No application code has been written yet.
> Read [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) — the complete technical design for Version 1.

## Planned stack (locked)

| Layer | Technology |
|---|---|
| Frontend | Next.js · React · TypeScript · Tailwind CSS · shadcn/ui · Recharts · React Hook Form · Zod · TanStack Query |
| Backend | Node.js · NestJS · TypeScript · REST · Swagger/OpenAPI |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | HTTP-only cookie sessions (Postgres-backed) · Argon2id |
| Authorization | RBAC + per-organization isolation + property scoping |
| Testing | Jest · Supertest · Vitest · Playwright |
| Tooling | pnpm workspaces · Docker Compose |
| Architecture | Modular monolith |

## Documentation

- [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) — architecture, data model, RBAC matrix, security model,
  financial flows, API map, phases, and the V1 scope verification.

Installation, environment, migration, seed, test and deployment instructions are written as
Phase 1 lands.
