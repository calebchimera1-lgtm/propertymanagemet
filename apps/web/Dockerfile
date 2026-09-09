# ─────────────────────────────────────────────────────────────────────────────
# Web image. Uses Next.js standalone output so the runtime layer carries only
# what the server actually needs.
#   docker build -f apps/web/Dockerfile .
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && apk add --no-cache dumb-init
WORKDIR /app

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

FROM deps AS development
ENV NODE_ENV=development
COPY . .
RUN pnpm --filter "./packages/*" build
EXPOSE 3000
CMD ["pnpm", "--filter", "@pm/web", "dev"]

FROM deps AS build
# NEXT_PUBLIC_* values are inlined at build time, so the API URL must be known
# here. It contains no secret — that is the rule for anything NEXT_PUBLIC_.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm --filter "./packages/*" build && pnpm --filter @pm/web build

FROM base AS production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
