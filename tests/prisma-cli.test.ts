import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error - a plain .mjs build script, deliberately untyped.
import { fromDotEnv } from '../scripts/prisma.mjs';

/**
 * `scripts/prisma.mjs` exists so a single-database setup needs a single
 * variable: the schema references DIRECT_URL, and Prisma treats a
 * referenced-but-unset variable as a hard error rather than falling back to
 * DATABASE_URL.
 *
 * The wrapper is a build-time script, so nothing else in the suite notices it
 * breaking — and it *was* broken: it defaulted DIRECT_URL only from the process
 * environment, while in development DATABASE_URL usually lives only in .env
 * (which Prisma loads for itself, too late to help). Every `db:*` command then
 * failed with "Environment variable not found: DIRECT_URL", which reads like a
 * schema problem rather than a wrapper that never saw the value.
 */

const dir = mkdtempSync(join(tmpdir(), 'pickle-env-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function dotEnv(contents: string): string {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.env`);
  writeFileSync(path, contents);
  return path;
}

describe('reading .env for the fallback', () => {
  it('finds a value written the way .env.example writes it', () => {
    const path = dotEnv('# comment\nDATABASE_URL="postgresql://user:pw@host:5432/db"\nAPP_SECRET="x"\n');
    expect(fromDotEnv('DATABASE_URL', path)).toBe('postgresql://user:pw@host:5432/db');
  });

  it('accepts an unquoted value and drops a trailing comment', () => {
    const path = dotEnv('DATABASE_URL=postgresql://localhost:5432/db  # local\n');
    expect(fromDotEnv('DATABASE_URL', path)).toBe('postgresql://localhost:5432/db');
  });

  it('does not confuse a variable whose name merely contains the one asked for', () => {
    const path = dotEnv('TEST_DATABASE_URL="postgresql://localhost:5432/scratch"\n');
    expect(fromDotEnv('DATABASE_URL', path)).toBeUndefined();
  });

  it('treats a blank value as absent, so the caller can fall through', () => {
    const path = dotEnv('DATABASE_URL=""\n');
    expect(fromDotEnv('DATABASE_URL', path)).toBeUndefined();
  });

  it('says nothing when there is no .env at all', () => {
    expect(fromDotEnv('DATABASE_URL', join(dir, 'nope.env'))).toBeUndefined();
  });
});

describe('running a Prisma command', () => {
  it('validates the schema without DIRECT_URL being set anywhere', () => {
    const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
    delete (env as Record<string, string | undefined>).DIRECT_URL;

    const result = spawnSync(process.execPath, ['scripts/prisma.mjs', 'validate'], {
      encoding: 'utf8',
      env,
    });

    expect(`${result.stdout}${result.stderr}`).not.toMatch(/DIRECT_URL/);
    expect(result.status).toBe(0);
  });

  it('reports a usage error rather than spawning nothing', () => {
    const result = spawnSync(process.execPath, ['scripts/prisma.mjs'], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage/);
  });
});
