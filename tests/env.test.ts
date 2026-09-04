import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * The site URL decides where entry passes point. A first deploy that silently
 * fell back to localhost would mint passes nobody could open, so the resolution
 * order is pinned here.
 */
async function loadSiteUrl() {
  vi.resetModules();
  const { siteUrl } = await import('@/lib/env');
  return siteUrl;
}

const KEYS = ['NEXT_PUBLIC_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe('siteUrl', () => {
  it('prefers an explicit setting, so a custom domain always wins', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://picklelounge.ph';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'pickle.vercel.app';
    expect(await loadSiteUrl()).toBe('https://picklelounge.ph');
  });

  it('strips a trailing slash so links do not double up', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://picklelounge.ph/';
    expect(await loadSiteUrl()).toBe('https://picklelounge.ph');
  });

  it("falls back to Vercel's production domain on a first deploy", async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'pickle-lounge.vercel.app';
    expect(await loadSiteUrl()).toBe('https://pickle-lounge.vercel.app');
  });

  it('uses the per-deployment URL on a preview build', async () => {
    process.env.VERCEL_URL = 'pickle-lounge-git-branch.vercel.app';
    expect(await loadSiteUrl()).toBe('https://pickle-lounge-git-branch.vercel.app');
  });

  it('does not double the scheme if one is already present', async () => {
    process.env.VERCEL_URL = 'https://pickle-lounge.vercel.app';
    expect(await loadSiteUrl()).toBe('https://pickle-lounge.vercel.app');
  });

  it('falls back to localhost only when nothing else is available', async () => {
    expect(await loadSiteUrl()).toBe('http://localhost:3000');
  });
});
