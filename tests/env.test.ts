import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { env, paymentsLive, emailLive, resetEnvCache, siteUrl } from '@/lib/env';

/**
 * Configuration is resolved on first use rather than at import, so a build can
 * succeed without production secrets while the running app still refuses a bad
 * configuration. Both halves of that are pinned here.
 */

const KEYS = [
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
  'APP_SECRET',
  'PAYMONGO_SECRET_KEY',
  'RESEND_API_KEY',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.APP_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
  resetEnvCache();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
  resetEnvCache();
});

describe('siteUrl', () => {
  it('prefers an explicit setting, so a custom domain always wins', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://picklelounge.ph';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'pickle.vercel.app';
    expect(siteUrl()).toBe('https://picklelounge.ph');
  });

  it('strips a trailing slash so links do not double up', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://picklelounge.ph/';
    expect(siteUrl()).toBe('https://picklelounge.ph');
  });

  it("falls back to Vercel's production domain on a first deploy", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'pickle-lounge.vercel.app';
    expect(siteUrl()).toBe('https://pickle-lounge.vercel.app');
  });

  it('uses the per-deployment URL on a preview build', () => {
    process.env.VERCEL_URL = 'pickle-lounge-git-branch.vercel.app';
    expect(siteUrl()).toBe('https://pickle-lounge-git-branch.vercel.app');
  });

  it('does not double the scheme if one is already present', () => {
    process.env.VERCEL_URL = 'https://pickle-lounge.vercel.app';
    expect(siteUrl()).toBe('https://pickle-lounge.vercel.app');
  });

  it('falls back to localhost only when nothing else is available', () => {
    expect(siteUrl()).toBe('http://localhost:3000');
  });
});

describe('validation', () => {
  it('rejects a missing APP_SECRET, naming the variable', () => {
    delete process.env.APP_SECRET;
    resetEnvCache();
    expect(() => env()).toThrow(/APP_SECRET/);
  });

  it('rejects an APP_SECRET too short to be worth signing with', () => {
    process.env.APP_SECRET = 'short';
    resetEnvCache();
    expect(() => env()).toThrow(/at least 32 characters/);
  });

  it('names every missing variable at once, not just the first', () => {
    delete process.env.APP_SECRET;
    const url = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    resetEnvCache();
    try {
      expect(() => env()).toThrow(/APP_SECRET[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*APP_SECRET/);
    } finally {
      if (url !== undefined) process.env.DATABASE_URL = url;
      resetEnvCache();
    }
  });

  it('does not throw merely because a module imported it', async () => {
    // The regression this guards: validating at import time made the secrets a
    // *build*-time requirement, because Next imports every route module while
    // collecting page data. A deploy without them died naming an unrelated
    // route. Importing must stay free of side effects.
    delete process.env.APP_SECRET;
    resetEnvCache();
    await expect(import('@/lib/pass')).resolves.toBeDefined();
    await expect(import('@/lib/auth')).resolves.toBeDefined();
    await expect(import('@/lib/checkout')).resolves.toBeDefined();
  });
});

describe('feature detection', () => {
  it('runs the sandbox gateway and console mailer when unconfigured', () => {
    expect(paymentsLive()).toBe(false);
    expect(emailLive()).toBe(false);
  });

  it('goes live once credentials are present', () => {
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_abc';
    process.env.RESEND_API_KEY = 're_abc';
    resetEnvCache();
    expect(paymentsLive()).toBe(true);
    expect(emailLive()).toBe(true);
  });
});

describe('values people actually paste', () => {
  it('accepts a bare hostname, as copied from a hosting dashboard', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'picklelounge.vercel.app';
    expect(siteUrl()).toBe('https://picklelounge.vercel.app');
  });

  it('treats a blank value as unset rather than invalid', () => {
    // A hosting dashboard makes an empty variable very easy to create, and
    // "invalid url" is a confusing thing to say about an empty box.
    process.env.NEXT_PUBLIC_SITE_URL = '';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'picklelounge.vercel.app';
    expect(siteUrl()).toBe('https://picklelounge.vercel.app');
  });

  it('treats whitespace as unset too', () => {
    process.env.NEXT_PUBLIC_SITE_URL = '   ';
    expect(siteUrl()).toBe('http://localhost:3000');
  });

  it('still rejects something that is not a hostname at all', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'not a url at all !!';
    resetEnvCache();
    expect(() => env()).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it('reports a blank required value as absent, not as invalid', () => {
    process.env.APP_SECRET = '';
    resetEnvCache();
    try {
      env();
      throw new Error('expected a configuration error');
    } catch (error) {
      const problems = (error as { problems?: { name: string; present: boolean }[] }).problems ?? [];
      const appSecret = problems.find((p) => p.name === 'APP_SECRET');
      expect(appSecret?.present).toBe(false);
    }
  });

  it('reports a present-but-rejected value as invalid, not as missing', () => {
    process.env.APP_SECRET = 'too-short';
    resetEnvCache();
    try {
      env();
      throw new Error('expected a configuration error');
    } catch (error) {
      const problems = (error as { problems?: { name: string; present: boolean }[] }).problems ?? [];
      const appSecret = problems.find((p) => p.name === 'APP_SECRET');
      expect(appSecret?.present).toBe(true);
    }
  });
});
