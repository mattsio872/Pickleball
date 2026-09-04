import { randomBytes } from 'node:crypto';
import { Prisma, type Booking, type Court } from '@prisma/client';
import { PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, pgErrorCode, prisma } from './db';
import { getSettings } from './settings';
import { priceFor } from './money';
import { addMinutes, venueInstant } from './time';
import { checkSlot, releaseExpiredHolds } from './availability';
import { AppError, NotFoundError, SlotTakenError, ValidationError } from './errors';

/**
 * Characters that survive being read aloud over the phone to the front desk:
 * no I/L/O/0/1 to confuse with each other.
 */
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRef(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return `PL-${out}`;
}

export function normaliseRef(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '');
  return cleaned.startsWith('PL-') ? cleaned : `PL-${cleaned.replace(/^PL/, '')}`;
}

export type BookingWithCourt = Booking & { court: Court };

export type CreateHoldInput = {
  courtId: string;
  dayKey: string;
  startMinutes: number;
  durationMinutes: number;
  customerName: string;
  customerEmail: string;
  customerMobile: string;
};

/**
 * Place a hold on a slot.
 *
 * The hold is what makes the payment step honest: the slot stops being offered
 * to anyone else the moment the booker commits to it, and is released
 * automatically if they wander off. Two safeguards run in order — an
 * application check that produces a readable error, then the database's
 * exclusion constraint, which is the one that actually guarantees uniqueness
 * when two people click at the same instant.
 */
export async function createHold(input: CreateHoldInput, now: Date = new Date()): Promise<BookingWithCourt> {
  const settings = await getSettings();
  const { timezone } = settings;

  if (!settings.durationsMinutes.includes(input.durationMinutes)) {
    throw new ValidationError(`We do not offer ${input.durationMinutes}-minute blocks.`);
  }
  if (input.startMinutes % 60 !== 0) {
    throw new ValidationError('Bookings start on the hour.');
  }

  const startsAt = venueInstant(input.dayKey, input.startMinutes, timezone);
  const endsAt = addMinutes(startsAt, input.durationMinutes);

  const check = await checkSlot({ courtId: input.courtId, startsAt, endsAt, now });
  if (!check.ok) {
    if (check.reason === 'booked') throw new SlotTakenError(check.message);
    throw new ValidationError(check.message);
  }

  const totalCents = priceFor(settings.hourlyRateCents, input.durationMinutes);
  const holdExpiresAt = addMinutes(now, settings.holdMinutes);

  // Retry only guards against a collision in the random reference, which is a
  // 1-in-887-million event per attempt, not against the slot being taken.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.booking.create({
        data: {
          ref: generateRef(),
          courtId: input.courtId,
          startsAt,
          endsAt,
          status: 'HELD',
          holdExpiresAt,
          hourlyRateCents: settings.hourlyRateCents,
          totalCents,
          currency: settings.currency,
          customerName: input.customerName,
          customerEmail: input.customerEmail.toLowerCase(),
          customerMobile: input.customerMobile,
          passSecret: randomBytes(32).toString('hex'),
          players: {
            create: { name: input.customerName, contact: input.customerMobile, isBooker: true },
          },
        },
        include: { court: true },
      });
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === PG_EXCLUSION_VIOLATION) {
        // Someone else's insert landed between our check and ours.
        throw new SlotTakenError();
      }
      if (code === PG_UNIQUE_VIOLATION && attempt < 4) continue;
      throw error;
    }
  }
  throw new AppError('Could not allocate a booking reference. Please try again.', 500, 'ref_collision');
}

/**
 * Mark a held booking as paid.
 *
 * Called from the payment webhook, which may arrive after the hold has already
 * lapsed — a slow wallet confirmation, or a webhook retried an hour later. In
 * that case the slot is re-acquired if it is still free; if somebody else has
 * taken it in the meantime the booking is left unconfirmed and reported back,
 * so the money can be refunded rather than silently kept for a court the party
 * cannot use.
 */
export async function confirmBooking(
  bookingId: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; booking: BookingWithCourt; alreadyConfirmed: boolean }
  | { ok: false; reason: 'slot_lost' | 'cancelled' | 'missing'; booking: BookingWithCourt | null }
> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { court: true } });
  if (!booking) return { ok: false, reason: 'missing', booking: null };
  if (booking.status === 'CONFIRMED') return { ok: true, booking, alreadyConfirmed: true };
  if (booking.status === 'CANCELLED') return { ok: false, reason: 'cancelled', booking };

  await releaseExpiredHolds(now);

  try {
    const confirmed = await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CONFIRMED', holdExpiresAt: null },
      include: { court: true },
    });
    return { ok: true, booking: confirmed, alreadyConfirmed: false };
  } catch (error) {
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) {
      // The hold lapsed and the court went to someone else.
      return { ok: false, reason: 'slot_lost', booking };
    }
    throw error;
  }
}

export async function findByRef(ref: string): Promise<BookingWithCourt | null> {
  return prisma.booking.findUnique({
    where: { ref: normaliseRef(ref) },
    include: { court: true },
  });
}

export async function findByRefWithParty(ref: string) {
  return prisma.booking.findUnique({
    where: { ref: normaliseRef(ref) },
    include: { court: true, players: { orderBy: [{ isBooker: 'desc' }, { createdAt: 'asc' }] }, payments: true },
  });
}

export async function requireByRef(ref: string): Promise<BookingWithCourt> {
  const booking = await findByRef(ref);
  if (!booking) throw new NotFoundError(`No booking found for ${normaliseRef(ref)}.`);
  return booking;
}

/** Whether the free-cancellation window is still open. */
export function cancellableUntil(booking: Booking, cancellationHours: number): Date {
  return addMinutes(booking.startsAt, -cancellationHours * 60);
}

export async function cancelBooking(bookingId: string, now: Date = new Date()): Promise<Booking> {
  return prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', holdExpiresAt: null, cancelledAt: now },
  });
}

export { Prisma };
