#!/usr/bin/env node
/**
 * Runs a Prisma CLI command with DIRECT_URL defaulted to DATABASE_URL.
 *
 * The datasource declares `directUrl` so migrations can bypass a connection
 * pooler (see prisma/schema.prisma). Prisma treats a referenced-but-unset
 * variable as a hard error, which would make DIRECT_URL mandatory even for a
 * plain unpooled Postgres that has no use for it. Defaulting it here keeps the
 * single-database case a single-variable affair.
 *
 * A .mjs wrapper rather than shell interpolation in the npm script, so this
 * behaves the same on Windows.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Read one variable out of `.env`.
 *
 * The wrapper cannot default DIRECT_URL from a DATABASE_URL it never sees, and
 * in development DATABASE_URL usually lives *only* in .env — Prisma loads that
 * file itself, long after this process has decided. Reading it here is what
 * makes the promise above true for the ordinary local setup instead of only
 * for a shell that happens to have exported the variable. Deliberately narrow:
 * it looks up single names, and never overrides the real environment.
 */
export function fromDotEnv(name, path = join(root, '.env')) {
  if (!existsSync(path)) return undefined;
  let contents;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== name) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (value) return value;
  }
  return undefined;
}

function main(args) {
  if (args.length === 0) {
    console.error('Usage: node scripts/prisma.mjs <prisma args...>');
    return 1;
  }

  const env = { ...process.env };
  if (!env.DIRECT_URL) {
    const fallback = env.DATABASE_URL || fromDotEnv('DATABASE_URL');
    if (fallback) env.DIRECT_URL = fallback;
  }

  // npm puts node_modules/.bin on PATH, but `node scripts/prisma.mjs …` run
  // directly does not — and without this the spawn below failed with no output
  // at all, which is a miserable thing to debug.
  const localBin = join(root, 'node_modules', '.bin');
  // Windows spells it `Path`; adding a second `PATH` key next to it would leave
  // the spawned process reading the one we did not touch.
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = [localBin, env[pathKey] ?? ''].filter(Boolean).join(delimiter);

  const result = spawnSync('prisma', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.error) {
    console.error(
      `Could not run the Prisma CLI: ${result.error.message}\n` +
        'Install dependencies first with `npm install`.',
    );
    return 1;
  }
  return result.status ?? 1;
}

// Runs as a command; imported (by its tests) it only offers the reader above.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
