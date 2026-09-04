import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createHold, confirmBooking } from '@/lib/booking';
import { getWeekSchedule, weekStartOf } from '@/lib/schedule';
import { venueInstant } from '@/lib/time';
import { migrateTestDatabase, resetDatabase, seedVenue, NOW, TEST_DAY } from './helpers';

const MANILA = 'Asia/Manila';
let courtA: string;
let courtB: string;

beforeAll(() => migrateTestDatabase());
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  const { courts } = await seedVenue();
  courtA = courts[0].id;
  courtB = courts[1].id;
});

async function book(courtId: string, hour: number, hours = 1, confirm = true) {
  const booking = await createHold(
    {
      courtId,
      dayKey: TEST_DAY,
      startMinutes: hour * 60,
      durationMinutes: hours * 60,
      customerName: 'Juan dela Cruz',
      customerEmail: 'juan@example.com',
      customerMobile: '0917 000 0000',
    },
    NOW,
  );
  if (confirm) await confirmBooking(booking.id, NOW);
  return booking;
}

describe('week boundaries', () => {
  it('starts the week on Monday', () => {
    // 2026-09-11 is a Friday.
    expect(weekStartOf('2026-09-11', MANILA)).toBe('2026-09-07');
    expect(weekStartOf('2026-09-07', MANILA)).toBe('2026-09-07');
    expect(weekStartOf('2026-09-13', MANILA)).toBe('2026-09-07'); // Sunday
    expect(weekStartOf('2026-09-14', MANILA)).toBe('2026-09-14'); // next Monday
  });
});

describe('the weekly grid', () => {
  it('covers seven days and every opening hour', async () => {
    const week = await getWeekSchedule({ weekOf: TEST_DAY, now: NOW });
    expect(week.days).toHaveLength(7);
    expect(week.days[0].dayKey).toBe('2026-09-07');
    expect(week.days[6].dayKey).toBe('2026-09-13');
    // Open 6, close 23 → 17 bookable hours.
    expect(week.hours).toHaveLength(17);
    expect(week.days.every((d) => d.cells.length === 17)).toBe(true);
  });

  it('puts a booking in its hour, on its day, for its court', async () => {
    await book(courtA, 19);
    const week = await getWeekSchedule({ weekOf: TEST_DAY, now: NOW });

    const friday = week.days.find((d) => d.dayKey === TEST_DAY)!;
    const at7 = friday.cells.find((c) => c.startMinutes === 19 * 60)!;
    expect(at7.bookings).toHaveLength(1);
    expect(at7.bookings[0].courtId).toBe(courtA);
    expect(at7.bookings[0].isStart).toBe(true);

    const at8 = friday.cells.find((c) => c.startMinutes === 20 * 60)!;
    expect(at8.bookings).toHaveLength(0);
  });

  it('spans every hour a long booking occupies, naming only the first', async () => {
    await book(courtA, 19, 3);
    const week = await getWeekSchedule({ weekOf: TEST_DAY, now: NOW });
    const friday = week.days.find((d) => d.dayKey === TEST_DAY)!;

    for (const [hour, expectStart] of [
      [19, true],
      [20, false],
      [21, false],
    ] as const) {
      const cell = friday.cells.find((c) => c.startMinutes === hour * 60)!;
      expect(cell.bookings).toHaveLength(1);
      expect(cell.bookings[0].isStart).toBe(expectStart);
      expect(cell.bookings[0].hours).toBe(3);
    }
    expect(friday.cells.find((c) => c.startMinutes === 22 * 60)!.bookings).toHaveLength(0);
  });

  it('shows two courts booked in the same hour side by side', async () => {
    await book(courtA, 19);
    await book(courtB, 19);
    const week = await getWeekSchedule({ weekOf: TEST_DAY, now: NOW });
    const cell = week.days.find((d) => d.dayKey === TEST_DAY)!.cells.find((c) => c.startMinutes === 19 * 60)!;
    expect(cell.bookings.map((b) => b.courtId).sort()).toEqual([courtA, courtB].sort());
  });

  it('marks an unpaid hold as held, not confirmed', async () => {
    await book(courtA, 19, 1, false);
    const week = await getWeekSchedule({ weekOf: TEST_DAY, now: NOW });
    const cell = week.days.find((d) => d.dayKey === TEST_DAY)!.cells.find((c) => c.startMinutes === 19 * 60)!;
    expect(cell.bookings[0].status).toBe('HELD');
  });

  it('marks a venue-wide closure', async () => {
    await prisma.closure.create({
      data: {
        courtId: null,
        startsAt: venueInstant(TEST_DAY, 18 * 60, MANILA),
        endsAt: venueInstant(TEST_DAY, 20 * 60, MANILA),
        reason: 'Holiday',
      },
    });
    const week = await getWeekSchedule({ weekOf: TEST_DAY, now: NOW });
    const friday = week.days.find((d) => d.dayKey === TEST_DAY)!;
    expect(friday.cells.find((c) => c.startMinutes === 18 * 60)!.closed).toBe(true);
    expect(friday.cells.find((c) => c.startMinutes === 20 * 60)!.closed).toBe(false);
  });

  it('totals only confirmed revenue, but counts every live booking', async () => {
    await book(courtA, 9);
    await book(courtA, 11, 2);
    await book(courtB, 9, 1, false); // held, unpaid

    const week = await getWeekSchedule({ weekOf: TEST_DAY, now: NOW });
    expect(week.totals.bookings).toBe(3);
    expect(week.totals.hoursBooked).toBe(4);
    expect(week.totals.revenueCents).toBe(65000 + 130000);
  });

  it('navigates to the weeks either side', async () => {
    const week = await getWeekSchedule({ weekOf: TEST_DAY, now: NOW });
    expect(week.previousWeek).toBe('2026-08-31');
    expect(week.nextWeek).toBe('2026-09-14');
  });

  it('leaves a neighbouring week alone', async () => {
    await book(courtA, 19);
    const next = await getWeekSchedule({ weekOf: '2026-09-14', now: NOW });
    expect(next.totals.bookings).toBe(0);
  });

  it('hides retired courts', async () => {
    await prisma.court.update({ where: { id: courtB }, data: { active: false } });
    const week = await getWeekSchedule({ weekOf: TEST_DAY, now: NOW });
    expect(week.courts.map((c) => c.id)).toEqual([courtA]);
  });
});
