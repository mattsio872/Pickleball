import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';
import { resetEnvCache } from '@/lib/env';
import { prisma } from '@/lib/db';
import { migrateTestDatabase, resetDatabase, seedVenue } from './helpers';

/**
 * The health endpoint is what someone reads when a deployment misbehaves, so
 * what it says has to be true and has to name the fix. It earned its own tests
 * the hard way: it once reported NEXT_PUBLIC_SITE_URL as *missing* when the
 * variable was plainly set in the dashboard — sending its reader to look in the
 * wrong place — and the endpoint had no test that would have caught it.
 */

type Health = {
  ok: boolean;
  checks: {
    configuration: { ok: boolean; missing?: string[]; invalid?: { name: string; problem: string }[] };
    database: { ok: boolean; seeded?: boolean };
    siteUrl?: unknown;
  };
};

async function health(): Promise<{ status: number; body: Health }> {
  const response = await GET();
  return { status: response.status, body: (await response.json()) as Health };
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const APP_SECRET = process.env.APP_SECRET;
const NODE_ENV = process.env.NODE_ENV;

function restoreEnv() {
  if (SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = SITE_URL;
  process.env.APP_SECRET = APP_SECRET!;
  // NODE_ENV is read-only in the Next types but writable at runtime; vitest
  // sets it to "test" and the production-only checks need it back.
  (process.env as Record<string, string | undefined>).NODE_ENV = NODE_ENV;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
  resetEnvCache();
}

beforeEach(async () => {
  migrateTestDatabase();
  restoreEnv();
  await resetDatabase();
});

afterAll(restoreEnv);

async function seedStaff() {
  await prisma.staffUser.create({
    data: { email: 'desk@picklelounge.ph', name: 'Desk', passwordHash: 'x', role: 'STAFF' },
  });
}

describe('a working deployment', () => {
  it('answers 200 and reports the origin it will build links from', async () => {
    await seedVenue();
    await seedStaff();

    const { status, body } = await health();

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks.configuration.ok).toBe(true);
    expect(body.checks.database).toMatchObject({ ok: true, seeded: true, courts: 2 });
    expect(body.checks.siteUrl).toBe('http://localhost:3000');
  });
});

describe('a database that was never seeded', () => {
  it('is reported as reachable but unusable, and names the command', async () => {
    const { status, body } = await health();

    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks.database).toMatchObject({ ok: true, seeded: false, courts: 0 });
    expect(JSON.stringify(body.checks.database)).toMatch(/db:seed/);
  });
});

describe('configuration', () => {
  it('never calls an optional setting missing just because it is unset', async () => {
    // The reported bug: an unset NEXT_PUBLIC_SITE_URL was listed under
    // "missing", which reads as "you must set this" for a variable the
    // platform supplies on its own.
    await seedVenue();
    await seedStaff();
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'pickle-lounge.vercel.app';
    resetEnvCache();

    const { body } = await health();

    expect(body.checks.configuration.ok).toBe(true);
    expect(body.checks.siteUrl).toBe('https://pickle-lounge.vercel.app');
  });

  it('separates a variable that is set but wrong from one that is absent', async () => {
    process.env.APP_SECRET = 'too-short-to-sign-with';
    resetEnvCache();

    const { status, body } = await health();

    expect(status).toBe(503);
    expect(body.checks.configuration.ok).toBe(false);
    expect(body.checks.configuration.missing).not.toContain('APP_SECRET');
    expect(body.checks.configuration.invalid?.map((i) => i.name)).toContain('APP_SECRET');
  });

  it('reports an absent required variable as missing', async () => {
    delete process.env.APP_SECRET;
    resetEnvCache();

    const { body } = await health();

    expect(body.checks.configuration.missing).toContain('APP_SECRET');
  });

  it('never echoes the value of a setting it complains about', async () => {
    process.env.APP_SECRET = 'a-secret-that-is-long-enough-to-be-real'.slice(0, 20);
    resetEnvCache();

    const { body } = await health();

    expect(JSON.stringify(body)).not.toContain('a-secret-that-is-long');
  });
});

describe('a production deployment that would build links to localhost', () => {
  it('fails the check rather than quietly minting unreachable passes', async () => {
    await seedVenue();
    await seedStaff();
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    resetEnvCache();

    const { status, body } = await health();

    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks.siteUrl).toMatchObject({ ok: false, value: 'http://localhost:3000' });
  });
});
