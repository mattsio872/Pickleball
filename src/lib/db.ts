import { PrismaClient } from '@prisma/client';

// Next.js hot-reloads modules in development, which would otherwise open a new
// pool on every edit until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Query logging. Silent under test: the suite deliberately provokes constraint
 * violations to prove they are caught, and Prisma prints each one to stderr,
 * which buries the actual results.
 */
const logLevels =
  process.env.NODE_ENV === 'test' || process.env.VITEST
    ? []
    : process.env.NODE_ENV === 'development'
      ? (['warn', 'error'] as const)
      : (['error'] as const);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: [...logLevels] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Postgres error code for a violated exclusion constraint. The booking writer
 * relies on this to tell "somebody just took this slot" apart from a genuine
 * failure, so it is named rather than sprinkled as a magic string.
 */
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_UNIQUE_VIOLATION = '23505';
/** Prisma's own code for a unique constraint it models. */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * Reads the underlying Postgres SQLSTATE from a Prisma error.
 *
 * Prisma reports the same database error in more than one shape. A constraint
 * it models (a unique violation) arrives as a PrismaClientKnownRequestError
 * with the code in `meta.code`; one it does not model — an EXCLUDE constraint,
 * which is exactly what guards against double-booking — arrives as a
 * PrismaClientUnknownRequestError with the SQLSTATE only inside the message
 * text. Checking the structured fields alone therefore misses the very case
 * this exists for, and the caller falls through to a 500 instead of "that slot
 * has just been taken". All three shapes are handled here.
 */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const meta = (error as { meta?: { code?: unknown } }).meta;
  if (meta && typeof meta.code === 'string') return meta.code;

  const code = (error as { code?: unknown }).code;
  // Prisma's own error codes look like P2002; a SQLSTATE is five alphanumerics.
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;

  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string') {
    const match = message.match(/PostgresError\s*\{\s*code:\s*"([0-9A-Z]{5})"/);
    if (match) return match[1];
  }
  return typeof code === 'string' ? code : undefined;
}

/**
 * Whether an error is a unique-constraint violation.
 *
 * Prisma reports a constraint it models with its own code (P2002) and never
 * surfaces the Postgres SQLSTATE, so comparing against 23505 alone silently
 * never matches — the caller falls through to a 500 instead of "that email
 * already has an account". Both codes mean the same thing here.
 */
export function isUniqueViolation(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code === PG_UNIQUE_VIOLATION || code === PRISMA_UNIQUE_VIOLATION;
}
