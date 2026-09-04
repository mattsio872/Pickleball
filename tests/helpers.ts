import { execSync } from 'node:child_process';
import { prisma } from '@/lib/db';

let migrated = false;

/** Brings the scratch database up to the current schema, once per run. */
export function migrateTestDatabase() {
  if (migrated) return;
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
  migrated = true;
}

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE bookings, courts, closures, payments, player_registrations, webhook_events, staff_users, settings RESTART IDENTITY CASCADE',
  );
}

export async function seedVenue(overrides: Partial<{ hourlyRateCents: number; openHour: number; closeHour: number }> = {}) {
  const settings = await prisma.settings.create({
    data: { id: 1, hourlyRateCents: 65000, openHour: 6, closeHour: 23, ...overrides },
  });
  const courts = await Promise.all(
    [
      { code: 'A', name: 'Center', sortOrder: 0 },
      { code: 'B', name: 'North', sortOrder: 1 },
    ].map((c) =>
      prisma.court.create({ data: { ...c, blurb: 'A court.', meta: 'Indoor' } }),
    ),
  );
  return { settings, courts };
}

/** A fixed "now" well before the test slots, so nothing is accidentally in the past. */
export const NOW = new Date('2026-09-10T02:00:00.000Z'); // 10AM Manila
export const TEST_DAY = '2026-09-11';
