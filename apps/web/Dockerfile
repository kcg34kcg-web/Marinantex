FROM node:20-alpine AS deps
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json

RUN npm ci

FROM deps AS builder
WORKDIR /workspace

COPY apps/web apps/web

RUN npm run build -w @marinantex/web

FROM node:20-alpine AS runner
WORKDIR /workspace

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=deps /workspace/package.json /workspace/package-lock.json ./
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=builder /workspace/apps/web/package.json ./apps/web/package.json
COPY --from=builder /workspace/apps/web/.next ./apps/web/.next
COPY --from=builder /workspace/apps/web/app ./apps/web/app
COPY --from=builder /workspace/apps/web/components ./apps/web/components
COPY --from=builder /workspace/apps/web/lib ./apps/web/lib
COPY --from=builder /workspace/apps/web/next.config.ts ./apps/web/next.config.ts
COPY --from=builder /workspace/apps/web/next-env.d.ts ./apps/web/next-env.d.ts
COPY --from=builder /workspace/apps/web/postcss.config.mjs ./apps/web/postcss.config.mjs
COPY --from=builder /workspace/apps/web/tailwind.config.ts ./apps/web/tailwind.config.ts

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "@marinantex/web"]
