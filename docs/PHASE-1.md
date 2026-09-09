# Phase 1 — Foundation

What was built, why it is shaped this way, and what deliberately was not built.
The design it implements is [`BLUEPRINT.md`](BLUEPRINT.md).

## Outcome

Register an organization → sign in → use the authenticated app shell → manage your profile,
devices, organization and settings → sign out. Everything a later phase plugs into is in place:
the request pipeline, tenant isolation, the RBAC matrix, the audit trail, and the test suites that
keep them honest.

## Request pipeline

```
TenantContextMiddleware   opens the AsyncLocalStorage scope, assigns a request id
  ↓
ThrottlerGuard            per-IP buckets; strict ones on the auth routes
  ↓
SessionAuthGuard          cookie → SHA-256 lookup → user, organization, roles, permissions
  ↓
CsrfGuard                 signed double-submit, constant-time, unsafe methods only
  ↓
PermissionsGuard          deny by default; a route must declare its policy
  ↓
Controller (thin) → Service (rules) → Prisma (tenant-scoped)
  ↓
AllExceptionsFilter       one error envelope, no internals, request id for correlation
```

Two deliberate departures from the blueprint's drawing, both recorded in code comments:

1. **CSRF runs after authentication**, because the expected token is an HMAC derived from the
   session. Unauthenticated unsafe routes (login, register, forgot/reset password) opt out with
   `@SkipCsrf` and are protected by `SameSite=Lax`, the CORS allow-list and rate limiting.
2. **The tenant context is opened by middleware**, not an interceptor. `AsyncLocalStorage.run()`
   must wrap the whole request to survive every `await`; an interceptor wrapping `next.handle()`
   would lose the context at subscription time.

## Structural decisions worth knowing

| Decision | Why |
|---|---|
| `packages/database` wraps the generated Prisma client | The blueprint's §2 layout keeps `prisma/` at the root as the source of truth; a tiny workspace package gives both apps one deterministic import path instead of relying on hoisting |
| `User.email` is globally unique | Found while wiring login: `@@unique([organizationId, email])` alone makes email-only sign-in ambiguous if the same address exists in two organizations. One account per address in V1; multi-org membership would need a membership table |
| Two Prisma clients | `PrismaService` is unscoped and awkward to reach for on purpose (auth lookups, jobs, seeds, isolation tests). Everything else injects the scoped client, which **throws** rather than running a tenant query with no tenant |
| Rate limits are configuration | `AUTH_REGISTER_LIMIT` and friends default to the production values. They exist so an end-to-end run can raise them, not so a deployment can weaken them by accident |
| `ThrottlerGuard` bound with `useExisting` | `useClass` keys the instance to `APP_GUARD`, which makes it unreachable by a test override |
| `incremental: false` in `tsconfig.build.json` | `nest build` deletes `dist` on every run; a surviving `.tsbuildinfo` convinces tsc the files it just deleted are still emitted, producing a `dist` of `.d.ts` files with no `.js`. This bit once and is now impossible |

## Test coverage

| Suite | Count | What it proves |
|---|---|---|
| Jest unit (`pnpm test:api`) | 35 | Password policy and hashing, deny-by-default authorization, environment validation, and that every model with an `organizationId` is registered with the tenant filter |
| Supertest integration (`pnpm test:e2e:api`) | 69 | Auth lifecycle, CSRF, cross-organization isolation on every endpoint, the RBAC matrix role-by-role, rate limiting |
| Vitest (`pnpm test:web`) | 15 | Money formatting as strings, API client error mapping and CSRF header behaviour |
| Playwright (`pnpm test:e2e`) | 13 | The Phase 1 journey on desktop **and** mobile viewports |

Notable assertions, because they are the ones that will matter later:

- A wrong password and an unknown email return an **identical** code and message.
- Registration, sign-in and sign-out are audited, and no audit row contains a password or a hash.
- `Organization A` gets `404` — never `403` — for `Organization B`'s records.
- A request that tries to send `organizationId` in the body is rejected outright.
- The tenant-scoped client throws when there is no tenant context.

## Not built in Phase 1, and not pretended at

- **Property scoping.** `PROPERTY_SCOPED_ROLES` and `scopedPropertyIds` exist as a contract, but
  `StaffAssignment` needs the `Property` table. Until Phase 2, `scopedPropertyIds` is `null` —
  unrestricted *within the caller's own organization*. Cross-organization isolation is complete.
- **Email delivery.** Both flows are real; the V1 adapter logs the link. The UI says so rather than
  claiming a message was sent.
- **Everything from Phase 2 onward**: properties, buildings, units, tenants, leases, rent, payments,
  receipts, expenses, maintenance, staff, documents, notifications, dashboard metrics, reports. The
  sidebar shows only what exists — a navigation full of links to unbuilt screens would look like a
  product and behave like a prototype.

## Verified on

Node 22, pnpm 10, PostgreSQL 16, run against a live database. Docker images and compose files are
written and reviewed but **were not run** in the environment this phase was built in — no Docker
daemon was available there.
