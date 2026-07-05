import { PrismaClient } from '@prisma/client';

/**
 * Worker Prisma client — ALWAYS uses DIRECT_URL (not pooled).
 * This is required for FOR UPDATE SKIP LOCKED transactions per SPEC.md Section 5
 * and IMPLEMENTATION_PLAN.md Section 1.1.
 */
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    },
  },
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
