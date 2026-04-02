import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __babylexitPrisma: PrismaClient | undefined;
}

function createUnavailablePrisma(error: unknown): PrismaClient {
  return new Proxy(
    {},
    {
      get() {
        throw error instanceof Error ? error : new Error('Prisma client kullanılamıyor.');
      },
    },
  ) as PrismaClient;
}

let prismaInstance: PrismaClient;
let pool: Pool | null = null;

try {
  const databaseUrl = process.env.DATABASE_URL;
  const adapter =
    typeof databaseUrl === 'string' && databaseUrl.trim().length > 0
      ? (() => {
          pool = new Pool({ connectionString: databaseUrl });
          return new PrismaPg(pool);
        })()
      : undefined;

  prismaInstance =
    global.__babylexitPrisma ??
    new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });

  if (process.env.NODE_ENV !== 'production') {
    global.__babylexitPrisma = prismaInstance;
  }
} catch (error) {
  console.warn('Prisma başlatılamadı, bellek fallback kullanılacak.', error);
  pool?.end().catch(() => undefined);
  pool = null;
  prismaInstance = createUnavailablePrisma(error);
}

export const prisma = prismaInstance;
