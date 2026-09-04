import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createHold, confirmBooking, generateRef, normaliseRef } from '@/lib/booking';
import { getDayAvailability, releaseExpiredHolds, checkSlot } from '@/lib/availability';
import { SlotTakenError, ValidationError } from '@/lib/errors';
import { venueInstant, addMinutes } from '@/lib/time';
import { migrateTestDatabase, resetDatabase, seedVenue, NOW, TEST_DAY } from './helpers';

const MANILA = 'Asia/Manila';

let courtA: { id: string };
let courtB: { id: string };

const customer = {
  customerName: 'Juan dela Cruz',
  customerEmail: 'juan@example.com',
  customerMobile: '0917 555 0134',
};

beforeAll(() => migrateTestDatabase());
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  const { courts } = await seedVenue();
  courtA = courts[0];
  courtB = courts[1];
});

describe('references', () => {
  it('are readable and unambiguous', () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateRef();
      expect(ref).toMatch(/^PL-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      // No characters that get misheard or misread at a counter.
      expect(ref.slice(3)).not.toMatch(/[ILO01]/);
    }
  });

  it('normalises what staff type in', () => {
    expect(normaliseRef('pl-k7q2m9')).toBe('PL-K7Q2M9');
    expect(normaliseRef('  K7Q2M9 ')).toBe('PL-K7Q2M9');
    expect(normaliseRef('PL-K7Q2M9')).toBe('PL-K7Q2M9');
  });
});

describe('createHold', () => {
  it('holds a slot at the right instant and price', async () => {
    const booking = await createHold(
      { courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 120, ...customer },
      NOW,
    );

    expect(booking.status).toBe('HELD');
    expect(booking.startsAt.toISOString()).toBe('2026-09-11T11:00:00.000Z'); // 7PM Manila
    expect(booking.endsAt.toISOString()).toBe('2026-09-11T13:00:00.000Z');
    expect(booking.totalCents).toBe(130000);
    expect(booking.hourlyRateCents).toBe(65000);
    expect(booking.holdExpiresAt).not.toBeNull();
  });

  it('refuses a block that is not a whole number of hours', async () => {
    await expect(
      createHold({ courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 90, ...customer }, NOW),
    ).rejects.toThrow(ValidationError);
  });

  it('adds the booker to the roster', async () => {
    const booking = await createHold(
      { courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer },
      NOW,
    );
    const players = await prisma.playerRegistration.findMany({ where: { bookingId: booking.id } });
    expect(players).toHaveLength(1);
    expect(players[0].isBooker).toBe(true);
    expect(players[0].name).toBe('Juan dela Cruz');
  });

  it('stores the email lowercased so lookups are consistent', async () => {
    const booking = await createHold(
      { courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer, customerEmail: 'JUAN@Example.COM' },
      NOW,
    );
    expect(booking.customerEmail).toBe('juan@example.com');
  });

  it('captures the rate at booking time, so later changes do not restate it', async () => {
    const booking = await createHold(
      { courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer },
      NOW,
    );
    await prisma.settings.update({ where: { id: 1 }, data: { hourlyRateCents: 90000 } });
    const reread = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reread.totalCents).toBe(65000);
  });

  it('rejects a duration the venue does not sell', async () => {
    await expect(
      createHold({ courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 240, ...customer }, NOW),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a start time that is not on the hour', async () => {
    await expect(
      createHold({ courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60 + 15, durationMinutes: 60, ...customer }, NOW),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a slot in the past', async () => {
    const later = new Date('2026-09-11T13:00:00.000Z'); // 9PM Manila, after a 7PM slot
    await expect(
      createHold({ courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer }, later),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a booking that would run past closing', async () => {
    await expect(
      createHold({ courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 22 * 60, durationMinutes: 180, ...customer }, NOW),
    ).rejects.toThrow(ValidationError);
  });
});

describe('no double-booking', () => {
  const slot = { dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer };

  it('refuses an identical slot', async () => {
    await createHold({ courtId: courtA.id, ...slot }, NOW);
    await expect(createHold({ courtId: courtA.id, ...slot }, NOW)).rejects.toThrow(SlotTakenError);
  });

  it('refuses a partial overlap from either side', async () => {
    await createHold({ courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 120, ...customer }, NOW);
    // Starts inside the existing booking.
    await expect(
      createHold({ courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 20 * 60, durationMinutes: 60, ...customer }, NOW),
    ).rejects.toThrow(SlotTakenError);
    // Ends inside it.
    await expect(
      createHold({ courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 18 * 60, durationMinutes: 120, ...customer }, NOW),
    ).rejects.toThrow(SlotTakenError);
  });

  it('allows back-to-back bookings', async () => {
    await createHold({ courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer }, NOW);
    const next = await createHold(
      { courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 20 * 60, durationMinutes: 60, ...customer },
      NOW,
    );
    expect(next.status).toBe('HELD');
  });

  it('allows the same slot on a different court', async () => {
    await createHold({ courtId: courtA.id, ...slot }, NOW);
    const other = await createHold({ courtId: courtB.id, ...slot }, NOW);
    expect(other.status).toBe('HELD');
  });

  it('holds the line when many requests race for one slot', async () => {
    const attempts = Array.from({ length: 25 }, (_, i) =>
      createHold({ courtId: courtA.id, ...slot, customerEmail: `racer${i}@example.com` }, NOW).then(
        () => 'created' as const,
        (error) => (error instanceof SlotTakenError ? ('rejected' as const) : Promise.reject(error)),
      ),
    );
    const outcomes = await Promise.all(attempts);

    expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'rejected')).toHaveLength(24);

    const live = await prisma.booking.count({ where: { status: { in: ['HELD', 'CONFIRMED'] } } });
    expect(live).toBe(1);
  });

  it('does not let a cancelled booking block the slot', async () => {
    const first = await createHold({ courtId: courtA.id, ...slot }, NOW);
    await prisma.booking.update({ where: { id: first.id }, data: { status: 'CANCELLED', holdExpiresAt: null } });
    const replacement = await createHold({ courtId: courtA.id, ...slot }, NOW);
    expect(replacement.status).toBe('HELD');
  });
});

describe('hold expiry', () => {
  const slot = { dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer };

  it('frees the slot once the hold lapses', async () => {
    const abandoned = await createHold({ courtId: courtA.id, ...slot }, NOW);
    const afterHold = addMinutes(abandoned.holdExpiresAt!, 1);

    // Still blocked a moment before it lapses.
    await expect(createHold({ courtId: courtA.id, ...slot }, NOW)).rejects.toThrow(SlotTakenError);

    const replacement = await createHold({ courtId: courtA.id, ...slot }, afterHold);
    expect(replacement.status).toBe('HELD');

    const original = await prisma.booking.findUniqueOrThrow({ where: { id: abandoned.id } });
    expect(original.status).toBe('EXPIRED');
  });

  it('never expires a confirmed booking', async () => {
    const booking = await createHold({ courtId: courtA.id, ...slot }, NOW);
    await confirmBooking(booking.id, NOW);
    await releaseExpiredHolds(new Date('2027-01-01T00:00:00.000Z'));
    const reread = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reread.status).toBe('CONFIRMED');
  });
});

describe('confirmBooking', () => {
  const slot = { dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer };

  it('confirms a held booking and clears the hold', async () => {
    const booking = await createHold({ courtId: courtA.id, ...slot }, NOW);
    const result = await confirmBooking(booking.id, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.booking.status).toBe('CONFIRMED');
      expect(result.booking.holdExpiresAt).toBeNull();
      expect(result.alreadyConfirmed).toBe(false);
    }
  });

  it('is idempotent', async () => {
    const booking = await createHold({ courtId: courtA.id, ...slot }, NOW);
    await confirmBooking(booking.id, NOW);
    const again = await confirmBooking(booking.id, NOW);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.alreadyConfirmed).toBe(true);
  });

  it('reports slot_lost when payment arrives after the slot was retaken', async () => {
    const abandoned = await createHold({ courtId: courtA.id, ...slot }, NOW);
    const afterHold = addMinutes(abandoned.holdExpiresAt!, 1);
    // Somebody else takes the court once the hold lapses.
    await createHold({ courtId: courtA.id, ...slot, customerEmail: 'someone@example.com' }, afterHold);

    // The original booker's payment finally clears.
    const result = await confirmBooking(abandoned.id, afterHold);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('slot_lost');
  });

  it('reports a missing booking rather than throwing', async () => {
    const result = await confirmBooking('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing');
  });
});

describe('availability', () => {
  it('marks a booked slot taken and its neighbours free', async () => {
    await createHold(
      { courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer },
      NOW,
    );

    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 60, now: NOW });
    const court = day.courts.find((c) => c.id === courtA.id)!;
    const at = (h: number) => court.slots.find((s) => s.startMinutes === h * 60)!;

    expect(at(19).available).toBe(false);
    expect(at(19).reason).toBe('booked');
    expect(at(18).available).toBe(true);
    expect(at(20).available).toBe(true);
  });

  it('blocks every start whose block would overlap a booking', async () => {
    await createHold(
      { courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer },
      NOW,
    );
    // A 2-hour block starting at 18:00 would run into the 19:00 booking.
    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 120, now: NOW });
    const court = day.courts.find((c) => c.id === courtA.id)!;
    expect(court.slots.find((s) => s.startMinutes === 18 * 60)!.available).toBe(false);
    expect(court.slots.find((s) => s.startMinutes === 17 * 60)!.available).toBe(true);
  });

  it('leaves other courts alone', async () => {
    await createHold(
      { courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer },
      NOW,
    );
    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 60, now: NOW });
    const b = day.courts.find((c) => c.id === courtB.id)!;
    expect(b.slots.find((s) => s.startMinutes === 19 * 60)!.available).toBe(true);
  });

  it('marks slots that would run past closing', async () => {
    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 180, now: NOW });
    const court = day.courts[0];
    expect(court.slots.find((s) => s.startMinutes === 21 * 60)!.reason).toBe('after-hours');
    expect(court.slots.find((s) => s.startMinutes === 20 * 60)!.available).toBe(true);
  });

  it('marks slots already past', async () => {
    const evening = new Date('2026-09-11T11:30:00.000Z'); // 7:30PM Manila
    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 60, now: evening });
    const court = day.courts[0];
    expect(court.slots.find((s) => s.startMinutes === 19 * 60)!.reason).toBe('past');
    expect(court.slots.find((s) => s.startMinutes === 21 * 60)!.available).toBe(true);
  });

  it('respects a court closure', async () => {
    await prisma.closure.create({
      data: {
        courtId: courtA.id,
        startsAt: venueInstant(TEST_DAY, 18 * 60, MANILA),
        endsAt: venueInstant(TEST_DAY, 20 * 60, MANILA),
        reason: 'Floor resurfacing',
      },
    });

    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 60, now: NOW });
    const a = day.courts.find((c) => c.id === courtA.id)!;
    const b = day.courts.find((c) => c.id === courtB.id)!;

    expect(a.slots.find((s) => s.startMinutes === 19 * 60)!.reason).toBe('closed');
    expect(a.slots.find((s) => s.startMinutes === 20 * 60)!.available).toBe(true);
    expect(b.slots.find((s) => s.startMinutes === 19 * 60)!.available).toBe(true);
  });

  it('respects a venue-wide closure', async () => {
    await prisma.closure.create({
      data: {
        courtId: null,
        startsAt: venueInstant(TEST_DAY, 0, MANILA),
        endsAt: venueInstant(TEST_DAY, 24 * 60, MANILA),
        reason: 'Public holiday',
      },
    });
    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 60, now: NOW });
    for (const court of day.courts) {
      expect(court.slots.every((s) => !s.available)).toBe(true);
    }
  });

  it('hides retired courts', async () => {
    await prisma.court.update({ where: { id: courtB.id }, data: { active: false } });
    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 60, now: NOW });
    expect(day.courts.map((c) => c.id)).toEqual([courtA.id]);
  });

  it('prices the day for the chosen duration', async () => {
    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 120, now: NOW });
    expect(day.totalCents).toBe(130000);
  });
});

describe('checkSlot', () => {
  it('explains why a slot cannot be taken', async () => {
    const startsAt = venueInstant(TEST_DAY, 19 * 60, MANILA);
    const endsAt = addMinutes(startsAt, 60);

    const free = await checkSlot({ courtId: courtA.id, startsAt, endsAt, now: NOW });
    expect(free.ok).toBe(true);

    await createHold(
      { courtId: courtA.id, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer },
      NOW,
    );
    const taken = await checkSlot({ courtId: courtA.id, startsAt, endsAt, now: NOW });
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.reason).toBe('booked');
  });
});
