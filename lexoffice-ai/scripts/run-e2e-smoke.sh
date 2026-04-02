#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DB_CONTAINER="${LEXOFFICE_E2E_DB_CONTAINER:-lexoffice-postgres-e2e}"
DB_PORT="${LEXOFFICE_E2E_DB_PORT:-55432}"
DB_NAME="${LEXOFFICE_E2E_DB_NAME:-lexoffice_ai}"
DB_USER="${LEXOFFICE_E2E_DB_USER:-postgres}"
DB_PASSWORD="${LEXOFFICE_E2E_DB_PASSWORD:-postgres}"
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker bulunamadı. E2E smoke için Docker gereklidir."
  exit 1
fi

if ! docker ps -a --format '{{.Names}}' | grep -Eq "^${DB_CONTAINER}$"; then
  docker run -d \
    --name "${DB_CONTAINER}" \
    -e POSTGRES_USER="${DB_USER}" \
    -e POSTGRES_PASSWORD="${DB_PASSWORD}" \
    -e POSTGRES_DB="${DB_NAME}" \
    -p "${DB_PORT}:5432" \
    postgres:16-alpine >/dev/null
else
  if ! docker ps --format '{{.Names}}' | grep -Eq "^${DB_CONTAINER}$"; then
    docker start "${DB_CONTAINER}" >/dev/null
  fi
fi

echo "E2E PostgreSQL bekleniyor: ${DB_CONTAINER} (${DB_PORT})"
for _ in $(seq 1 45); do
  if docker exec "${DB_CONTAINER}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "${DB_CONTAINER}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
  echo "PostgreSQL hazır olmadı."
  exit 1
fi

cd "${ROOT_DIR}"

echo "Prisma schema sync + seed hazırlanıyor..."
DATABASE_URL="${DB_URL}" corepack pnpm --filter @lexoffice/db exec prisma db push --skip-generate
DATABASE_URL="${DB_URL}" corepack pnpm --filter @lexoffice/db prisma:seed

echo "Playwright smoke çalıştırılıyor..."
DATABASE_URL="${DB_URL}" \
REDIS_URL="${REDIS_URL:-redis://localhost:6379}" \
AUTH_COOKIE_SECURE=false \
corepack pnpm --filter @lexoffice/web e2e
