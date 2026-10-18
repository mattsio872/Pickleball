import { execSync } from 'node:child_process';
import { prisma } from '@/lib/db';
import { dayKeyOf, shiftDayKey, venueInstant } from '@/lib/time';

let migrated = false;

/**
 * Brings the scratch database up to the current schema, once per run.
 *
 * Both connection variables have to be redirected. The datasource declares a
 * `directUrl`, and Prisma Migrate reads *that* rather than `url` — so
 * overriding DATABASE_URL alone would quietly migrate whatever DIRECT_URL
 * points at (the development database) and leave the test database empty.
 */
export function migrateTestDatabase() {
  if (migrated) return;
  const url = process.env.TEST_DATABASE_URL;
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
  migrated = true;
}

export async function resetDatabase() {
  // Customers are in the list because a leftover account is not inert: it holds
  // an email address, and the next test to register that address fails on the
  // unique constraint rather than on anything it meant to check.
  await prisma.$executeRawUnsafe(
    'TRUNCATE bookings, courts, closures, customers, payments, player_registrations, webhook_events, staff_users, settings RESTART IDENTITY CASCADE',
  );
}

export async function seedVenue(
  overrides: Partial<{ hourlyRateCents: number; openHour: number; closeHour: number; durationsMinutes: number[] }> = {},
) {
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

const MANILA = 'Asia/Manila';

/**
 * The clock the fixtures run on.
 *
 * These were fixed dates in September 2026, which worked until September 2026
 * went past: a hold created "then" is expired now, and eleven tests started
 * failing on their own, having been written correctly and never touched. The
 * dates are relative instead, keeping the same two properties the fixed ones
 * had — a "now" that is ahead of the real clock, so a hold made at it is live
 * whichever clock the code under test consults, and a test day entirely after
 * that, so every venue hour on it is bookable.
 */
export const NOW = venueInstant(shiftDayKey(dayKeyOf(new Date(), MANILA), 1, MANILA), 10 * 60, MANILA);
export const TEST_DAY = shiftDayKey(dayKeyOf(new Date(), MANILA), 2, MANILA);

/** An instant on the test day, venue-local — for asserting on exact times. */
export function testDayAt(hour: number, minutes = 0): Date {
  return venueInstant(TEST_DAY, hour * 60 + minutes, MANILA);
}
