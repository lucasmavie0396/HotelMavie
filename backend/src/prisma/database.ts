import { Prisma, PrismaClient } from '@prisma/client';

export function isSqlServer(url = process.env.DATABASE_URL ?? '') {
  return url.startsWith('sqlserver:');
}

export function prismaClientClass(url?: string): typeof PrismaClient {
  if (!isSqlServer(url)) return PrismaClient;
  return (require('.prisma/client-sqlserver') as { PrismaClient: typeof PrismaClient }).PrismaClient;
}

export function createPrismaClient(options?: Prisma.PrismaClientOptions) {
  const Client = prismaClientClass(options?.datasourceUrl);
  return new Client(options);
}

export function lockHint() {
  return isSqlServer() ? Prisma.raw('WITH (UPDLOCK, ROWLOCK)') : Prisma.empty;
}

export function forUpdate() {
  return isSqlServer() ? Prisma.empty : Prisma.raw('FOR UPDATE');
}

export function jsonValue<T>(value: T): T {
  return (isSqlServer() && value !== undefined && value !== null ? JSON.stringify(value) : value) as T;
}

export function jsonRead<T = unknown>(value: unknown): T {
  if (isSqlServer() && typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }
  return value as T;
}
