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

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/prisma.mjs <prisma args...>');
  process.exit(1);
}

const env = { ...process.env };
if (!env.DIRECT_URL && env.DATABASE_URL) env.DIRECT_URL = env.DATABASE_URL;

const result = spawnSync('prisma', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
