# ─────────────────────────────────────────────────────────────────────────────
# API image. Multi-stage: dependencies → build → slim runtime.
# Built from the repository root so the workspace packages are in context:
#   docker build -f apps/api/Dockerfile .
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && apk add --no-cache dumb-init
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/config/package.json ./packages/config/
COPY packages/database/package.json ./packages/database/
COPY packages/types/package.json ./packages/types/
COPY packages/ui/package.json ./packages/ui/
COPY packages/validation/package.json ./packages/validation/
RUN pnpm install --frozen-lockfile

# ── Development (used by docker-compose.yml, with the source bind-mounted) ───
FROM deps AS development
ENV NODE_ENV=development
COPY . .
RUN pnpm db:generate && pnpm --filter "./packages/*" build
EXPOSE 3001
CMD ["pnpm", "--filter", "@pm/api", "dev"]

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm db:generate \
 && pnpm --filter "./packages/*" build \
 && pnpm --filter @pm/api build \
 && pnpm prune --prod

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production
# Never run the application as root.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nodejs -G nodejs

COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/packages ./packages
COPY --from=build --chown=nodejs:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=nodejs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nodejs:nodejs /app/package.json ./package.json

RUN mkdir -p /app/storage/uploads && chown -R nodejs:nodejs /app/storage
USER nodejs
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/main.js"]
