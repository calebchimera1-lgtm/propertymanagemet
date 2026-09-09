# @pm/database

Thin workspace wrapper around the Prisma client generated from `prisma/schema.prisma`
at the repository root.

- Generate: `pnpm db:generate` (writes `packages/database/generated/client`, git-ignored)
- Import: `import { PrismaClient, Prisma } from '@pm/database'`

Nothing else belongs in this package. Query logic lives in the API's repositories.
