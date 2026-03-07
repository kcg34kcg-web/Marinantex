FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/mail/package.json packages/mail/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
RUN corepack pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack pnpm --filter @lexoffice/db prisma:generate
RUN corepack pnpm --filter @lexoffice/worker build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build /app/packages ./packages
CMD ["node", "apps/worker/dist/index.js"]
