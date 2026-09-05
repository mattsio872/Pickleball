import type { Booking, Court } from '@prisma/client';
import { PG_EXCLUSION_VIOLATION, pgErrorCode, prisma } from './db';
import { getSettings } from './settings';
import { priceFor } from './money';
import { addMinutes, venueInstant, isDayKey, venueHour, timeLabel } from './time';
import { releaseExpiredHolds } from './availability';
import { ForbiddenError, NotFoundError, SlotTakenError, ValidationError } from './errors';

/**
 * Staff edits to an existing booking.
 *
 * Three operations, deliberately distinct, because they have very different
 * consequences:
 *
 *   move    — the party is still coming, on a different court or at a
 *             different time. The reference and the pass survive.
 *   release — the party is not coming. The court goes back on sale and the
 *             record stays, because money changed hands and the accounts have
 *             to still add up.
 *   delete  — the row goes. Only for bookings that never took money.
 *
 * "Delete" is the one people reach for by habit and almost never want: a paid
 * booking that is deleted takes its payment record with it, and the venue can
 * no longer show what it was paid or reconcile the provider's statement.
 */

export type BookingWithCourt = Booking & { court: Court };

export type MoveInput = {
  bookingId: string;
  courtId?: string;
  dayKey?: string;
  startMinutes?: number;
  durationMinutes?: number;
  customerName?: string;
  customerEmail?: string;
  customerMobile?: string;
};

export type MoveResult = {
  booking: BookingWithCourt;
  /** Set when the slot changed, so staff can see what the party is now owed. */
  priceChange: { fromCents: number; toCents: number } | null;
  slotChanged: boolean;
};

/** Whether this booking has money against it that a deletion would destroy. */
export async function hasSettledPayment(bookingId: string): Promise<boolean> {
  const paid = await prisma.payment.count({ where: { bookingId, status: 'PAID' } });
  return paid > 0;
}

export async function moveBooking(input: MoveInput, now: Date = new Date()): Promise<MoveResult> {
  const settings = await getSettings();
  const { timezone } = settings;

  const existing = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    include: { court: true },
  });
  if (!existing) throw new NotFoundError('That booking no longer exists.');
  if (existing.status !== 'HELD' && existing.status !== 'CONFIRMED') {
    throw new ValidationError(
      `This booking is ${existing.status.toLowerCase()} and does not hold a court. Restore it first if you want to move it.`,
    );
  }

  // Work out the slot being asked for, defaulting each part to what it is now.
  const currentDayKey = venueDayKeyOf(existing.startsAt, timezone);
  const currentStart = minutesOf(existing.startsAt, timezone);
  const currentDuration = Math.round((existing.endsAt.getTime() - existing.startsAt.getTime()) / 60_000);

  const dayKey = input.dayKey ?? currentDayKey;
  const startMinutes = input.startMinutes ?? currentStart;
  const durationMinutes = input.durationMinutes ?? currentDuration;
  const courtId = input.courtId ?? existing.courtId;

  if (!isDayKey(dayKey)) throw new ValidationError('That is not a valid date.');
  if (startMinutes % 60 !== 0) throw new ValidationError('Bookings start on the hour.');
  if (durationMinutes % 60 !== 0) throw new ValidationError('Courts are booked in whole hours.');
  if (!settings.durationsMinutes.includes(durationMinutes)) {
    throw new ValidationError(`The venue does not sell ${durationMinutes / 60}-hour blocks.`);
  }

  const startsAt = venueInstant(dayKey, startMinutes, timezone);
  const endsAt = addMinutes(startsAt, durationMinutes);

  const slotChanged =
    courtId !== existing.courtId ||
    startsAt.getTime() !== existing.startsAt.getTime() ||
    endsAt.getTime() !== existing.endsAt.getTime();

  if (slotChanged) {
    const court = await prisma.court.findUnique({ where: { id: courtId } });
    if (!court) throw new ValidationError('That court does not exist.');
    if (!court.active) throw new ValidationError(`Court ${court.code} is retired and cannot take bookings.`);

    const opensAt = venueHour(dayKey, settings.openHour, timezone);
    const closesAt = venueHour(dayKey, settings.closeHour, timezone);
    if (startsAt < opensAt || endsAt > closesAt) {
      throw new ValidationError(
        `The venue is open ${timeLabel(settings.openHour * 60)} to ${timeLabel(settings.closeHour * 60)}.`,
      );
    }

    // Staff are allowed to place a booking in the past — correcting yesterday's
    // record is a real thing to need — but a closure is a hard no, because the
    // court will not physically be there.
    const closure = await prisma.closure.findFirst({
      where: {
        OR: [{ courtId }, { courtId: null }],
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    if (closure) throw new ValidationError(`That window is closed: ${closure.reason}.`);

    await releaseExpiredHolds(now);
  }

  // The rate captured when the booking was made still applies; a later price
  // rise must not silently re-bill somebody whose booking is merely being moved.
  const totalCents = priceFor(existing.hourlyRateCents, durationMinutes);

  try {
    const booking = await prisma.booking.update({
      where: { id: existing.id },
      data: {
        courtId,
        startsAt,
        endsAt,
        totalCents,
        ...(input.customerName ? { customerName: input.customerName.trim() } : {}),
        ...(input.customerEmail ? { customerEmail: input.customerEmail.trim().toLowerCase() } : {}),
        ...(input.customerMobile ? { customerMobile: input.customerMobile.trim() } : {}),
      },
      include: { court: true },
    });

    return {
      booking,
      slotChanged,
      priceChange:
        totalCents === existing.totalCents ? null : { fromCents: existing.totalCents, toCents: totalCents },
    };
  } catch (error) {
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) {
      throw new SlotTakenError('Another booking already holds that court at that time.');
    }
    throw error;
  }
}

/**
 * Take the booking off the court without destroying the record.
 *
 * The slot goes back on sale immediately. Any refund is a separate act in the
 * payment provider's dashboard — this does not move money, and says so.
 */
export async function releaseBooking(bookingId: string, now: Date = new Date()) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { court: true, payments: { where: { status: 'PAID' }, take: 1 } },
  });
  if (!booking) throw new NotFoundError('That booking no longer exists.');
  if (booking.status === 'CANCELLED') throw new ValidationError('That booking has already been released.');

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', holdExpiresAt: null, cancelledAt: now },
    include: { court: true },
  });

  return {
    booking: updated,
    /** True when money was taken and somebody must decide about a refund. */
    wasPaid: booking.payments.length > 0,
    paidCents: booking.payments[0]?.amountCents ?? 0,
  };
}

/** Put a released booking back, if nothing has taken the slot meanwhile. */
export async function restoreBooking(bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { payments: true } });
  if (!booking) throw new NotFoundError('That booking no longer exists.');
  if (booking.status !== 'CANCELLED') throw new ValidationError('That booking is not released.');

  const wasPaid = booking.payments.some((p) => p.status === 'PAID');

  try {
    return await prisma.booking.update({
      where: { id: bookingId },
      // A booking that was never paid goes back to being an expired hold rather
      // than a confirmed booking, so restoring cannot conjure a paid slot.
      data: { status: wasPaid ? 'CONFIRMED' : 'EXPIRED', cancelledAt: null },
      include: { court: true },
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) {
      throw new SlotTakenError('That slot has been booked by somebody else since it was released.');
    }
    throw error;
  }
}

/**
 * Remove the row entirely.
 *
 * Refused for a booking that took money unless the caller explicitly insists,
 * because deleting one destroys the only record of a payment the venue
 * received and cannot be undone.
 */
export async function deleteBooking(options: { bookingId: string; force?: boolean }) {
  const booking = await prisma.booking.findUnique({
    where: { id: options.bookingId },
    include: { court: true, payments: { where: { status: 'PAID' } } },
  });
  if (!booking) throw new NotFoundError('That booking no longer exists.');

  const paid = booking.payments.reduce((sum, p) => sum + p.amountCents, 0);
  if (booking.payments.length > 0 && !options.force) {
    throw new ForbiddenError(
      `${booking.ref} was paid. Releasing it frees the court and keeps the record; deleting it destroys the ` +
        'proof of payment. Release it instead, or confirm you really mean to delete a paid booking.',
    );
  }

  await prisma.booking.delete({ where: { id: options.bookingId } });
  return { ref: booking.ref, deletedPaidCents: paid };
}

function venueDayKeyOf(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function minutesOf(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}
