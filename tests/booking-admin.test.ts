import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createHold, confirmBooking } from '@/lib/booking';
import { startCheckout, applyPaymentEvent } from '@/lib/checkout';
import { deleteBooking, moveBooking, releaseBooking, restoreBooking } from '@/lib/booking-admin';
import { getDayAvailability } from '@/lib/availability';
import { ForbiddenError, NotFoundError, SlotTakenError, ValidationError } from '@/lib/errors';
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

async function book(options: { courtId?: string; hour?: number; hours?: number; confirm?: boolean } = {}) {
  const booking = await createHold(
    {
      courtId: options.courtId ?? courtA,
      dayKey: TEST_DAY,
      startMinutes: (options.hour ?? 19) * 60,
      durationMinutes: (options.hours ?? 1) * 60,
      customerName: 'Juan dela Cruz',
      customerEmail: 'juan@example.com',
      customerMobile: '0917 555 0134',
    },
    NOW,
  );
  if (options.confirm ?? true) await confirmBooking(booking.id, NOW);
  return booking;
}

/** A booking with a real PAID payment behind it, as production would have. */
async function paidBooking(hour = 19) {
  const booking = await book({ hour, confirm: false });
  const session = await startCheckout({ bookingId: booking.id, method: 'gcash' });
  await applyPaymentEvent({
    eventId: `evt_${booking.ref}`,
    type: 'checkout_session.payment.paid',
    checkoutSessionId: session.sessionId,
    bookingRef: booking.ref,
    bookingId: booking.id,
    providerPaymentId: 'pay_test',
    method: 'gcash',
    amountCents: booking.totalCents,
    status: 'paid',
  });
  return booking;
}

describe('moving a booking', () => {
  it('moves it to another court', async () => {
    const booking = await book();
    const result = await moveBooking({ bookingId: booking.id, courtId: courtB }, NOW);
    expect(result.booking.courtId).toBe(courtB);
    expect(result.slotChanged).toBe(true);
  });

  it('moves it to another time, and frees the old slot', async () => {
    const booking = await book({ hour: 19 });
    await moveBooking({ bookingId: booking.id, startMinutes: 21 * 60 }, NOW);

    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 60, now: NOW });
    const court = day.courts.find((c) => c.id === courtA)!;
    expect(court.slots.find((s) => s.startMinutes === 19 * 60)!.available).toBe(true);
    expect(court.slots.find((s) => s.startMinutes === 21 * 60)!.available).toBe(false);
  });

  it('reprices a longer block at the rate the booking captured', async () => {
    const booking = await book({ hours: 1 });
    await prisma.settings.update({ where: { id: 1 }, data: { hourlyRateCents: 90000 } });

    const result = await moveBooking({ bookingId: booking.id, durationMinutes: 120 }, NOW);
    // Two hours at the ORIGINAL ₱650, not the new ₱900.
    expect(result.booking.totalCents).toBe(130000);
    expect(result.priceChange).toEqual({ fromCents: 65000, toCents: 130000 });
  });

  it('reports no price change when only the court moves', async () => {
    const booking = await book();
    const result = await moveBooking({ bookingId: booking.id, courtId: courtB }, NOW);
    expect(result.priceChange).toBeNull();
  });

  it('refuses to move it onto an occupied slot', async () => {
    await book({ courtId: courtB, hour: 21 });
    const booking = await book({ courtId: courtA, hour: 19 });
    await expect(
      moveBooking({ bookingId: booking.id, courtId: courtB, startMinutes: 21 * 60 }, NOW),
    ).rejects.toThrow(SlotTakenError);
  });

  it('lets a booking overlap only itself', async () => {
    // Extending in place overlaps the row being updated; the constraint must
    // not treat a booking as conflicting with itself.
    const booking = await book({ hours: 1 });
    const result = await moveBooking({ bookingId: booking.id, durationMinutes: 180 }, NOW);
    expect(result.booking.endsAt.getTime() - result.booking.startsAt.getTime()).toBe(3 * 3_600_000);
  });

  it('refuses a block that runs past closing', async () => {
    const booking = await book({ hour: 19 });
    await expect(
      moveBooking({ bookingId: booking.id, startMinutes: 22 * 60, durationMinutes: 180 }, NOW),
    ).rejects.toThrow(/open/i);
  });

  it('refuses a half-hour block', async () => {
    const booking = await book();
    await expect(moveBooking({ bookingId: booking.id, durationMinutes: 90 }, NOW)).rejects.toThrow(
      /whole hours/,
    );
  });

  it('refuses a retired court', async () => {
    const booking = await book();
    await prisma.court.update({ where: { id: courtB }, data: { active: false } });
    await expect(moveBooking({ bookingId: booking.id, courtId: courtB }, NOW)).rejects.toThrow(/retired/);
  });

  it('refuses a window that is closed', async () => {
    await prisma.closure.create({
      data: {
        courtId: courtB,
        startsAt: venueInstant(TEST_DAY, 20 * 60, MANILA),
        endsAt: venueInstant(TEST_DAY, 22 * 60, MANILA),
        reason: 'Resurfacing',
      },
    });
    const booking = await book({ hour: 19 });
    await expect(
      moveBooking({ bookingId: booking.id, courtId: courtB, startMinutes: 20 * 60 }, NOW),
    ).rejects.toThrow(/Resurfacing/);
  });

  it('corrects the booker details without touching the slot', async () => {
    const booking = await book();
    const result = await moveBooking(
      {
        bookingId: booking.id,
        customerName: 'Maria Reyes',
        customerEmail: 'MARIA@Example.com',
        customerMobile: '0918 111 2222',
      },
      NOW,
    );
    expect(result.slotChanged).toBe(false);
    expect(result.booking.customerName).toBe('Maria Reyes');
    expect(result.booking.customerEmail).toBe('maria@example.com');
  });

  it('refuses to move a released booking', async () => {
    const booking = await book();
    await releaseBooking(booking.id, NOW);
    await expect(moveBooking({ bookingId: booking.id, courtId: courtB }, NOW)).rejects.toThrow(
      /does not hold a court/,
    );
  });

  it('reports a booking that does not exist', async () => {
    await expect(moveBooking({ bookingId: 'nope' }, NOW)).rejects.toThrow(NotFoundError);
  });
});

describe('releasing a booking', () => {
  it('frees the court and keeps the record', async () => {
    const booking = await book();
    const result = await releaseBooking(booking.id, NOW);

    expect(result.booking.status).toBe('CANCELLED');
    const still = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(still).not.toBeNull();

    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 60, now: NOW });
    const court = day.courts.find((c) => c.id === courtA)!;
    expect(court.slots.find((s) => s.startMinutes === 19 * 60)!.available).toBe(true);
  });

  it('flags that money was taken, and does not move it', async () => {
    const booking = await paidBooking();
    const result = await releaseBooking(booking.id, NOW);

    expect(result.wasPaid).toBe(true);
    expect(result.paidCents).toBe(65000);
    // The payment record is untouched — refunding is a separate, human act.
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe('PAID');
  });

  it('lets somebody else take the freed slot', async () => {
    const first = await book();
    await releaseBooking(first.id, NOW);
    const second = await book();
    expect(second.id).not.toBe(first.id);
  });

  it('refuses to release twice', async () => {
    const booking = await book();
    await releaseBooking(booking.id, NOW);
    await expect(releaseBooking(booking.id, NOW)).rejects.toThrow(/already been released/);
  });
});

describe('putting a released booking back', () => {
  it('restores a paid booking as confirmed', async () => {
    const booking = await paidBooking();
    await releaseBooking(booking.id, NOW);
    const restored = await restoreBooking(booking.id);
    expect(restored.status).toBe('CONFIRMED');
  });

  it('restores an unpaid one as expired, never as confirmed', async () => {
    // Restoring must not conjure a paid slot out of one that never was.
    const booking = await book({ confirm: false });
    await releaseBooking(booking.id, NOW);
    const restored = await restoreBooking(booking.id);
    expect(restored.status).toBe('EXPIRED');
  });

  it('refuses when somebody else has taken the slot', async () => {
    const first = await paidBooking();
    await releaseBooking(first.id, NOW);
    await book(); // somebody else takes it
    await expect(restoreBooking(first.id)).rejects.toThrow(SlotTakenError);
  });

  it('refuses to restore a booking that was never released', async () => {
    const booking = await book();
    await expect(restoreBooking(booking.id)).rejects.toThrow(/not released/);
  });
});

describe('deleting a booking', () => {
  it('removes one that never took money', async () => {
    const booking = await book({ confirm: false });
    const result = await deleteBooking({ bookingId: booking.id });
    expect(result.ref).toBe(booking.ref);
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).toBeNull();
  });

  it('refuses a paid booking, and says what to do instead', async () => {
    const booking = await paidBooking();
    await expect(deleteBooking({ bookingId: booking.id })).rejects.toThrow(ForbiddenError);
    await expect(deleteBooking({ bookingId: booking.id })).rejects.toThrow(/Releas/);
    // Still there.
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).not.toBeNull();
  });

  it('deletes a paid booking only when explicitly forced', async () => {
    const booking = await paidBooking();
    const result = await deleteBooking({ bookingId: booking.id, force: true });
    expect(result.deletedPaidCents).toBe(65000);
    expect(await prisma.booking.findUnique({ where: { id: booking.id } })).toBeNull();
    // The payment rows go with it — which is exactly why it is guarded.
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('frees the court', async () => {
    const booking = await book({ confirm: false });
    await deleteBooking({ bookingId: booking.id });
    const day = await getDayAvailability({ dayKey: TEST_DAY, durationMinutes: 60, now: NOW });
    const court = day.courts.find((c) => c.id === courtA)!;
    expect(court.slots.find((s) => s.startMinutes === 19 * 60)!.available).toBe(true);
  });

  it('reports one that does not exist', async () => {
    await expect(deleteBooking({ bookingId: 'nope' })).rejects.toThrow(NotFoundError);
  });
});
