FROM node:20-alpine AS deps
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

FROM deps AS builder
WORKDIR /workspace

COPY apps/api apps/api

RUN npm run prisma:generate -w @marinantex/api
RUN npm run build -w @marinantex/api

FROM node:20-alpine AS runner
WORKDIR /workspace

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=deps /workspace/package.json /workspace/package-lock.json ./
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=builder /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=builder /workspace/apps/api/dist ./apps/api/dist
COPY --from=builder /workspace/apps/api/prisma ./apps/api/prisma

EXPOSE 4000

CMD ["sh", "-c", "npm run prisma:migrate:deploy -w @marinantex/api && npm run start:prod -w @marinantex/api"]
