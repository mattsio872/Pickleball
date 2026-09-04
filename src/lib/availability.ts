import { prisma } from './db';
import { getSettings } from './settings';
import { priceFor } from './money';
import {
  addMinutes,
  dayKeyOf,
  isDayKey,
  timeLabel,
  venueHour,
  venueInstant,
} from './time';
import type { Settings } from '@prisma/client';

/**
 * Real availability, computed from what is actually in the database.
 *
 * The design mockup faked this with `((dayIdx * 31 + court * 17 + hour * 7) % 11) < 3`
 * — a stable-looking pattern with no bookings behind it. Here a slot is taken
 * because somebody took it.
 */

export type SlotView = {
  /** Minutes from venue-local midnight, e.g. 1140 for 7PM. */
  startMinutes: number;
  label: string;
  available: boolean;
  /** Why not, when unavailable — drives the tooltip and the disabled styling. */
  reason: 'booked' | 'closed' | 'past' | 'after-hours' | null;
};

export type CourtAvailability = {
  id: string;
  code: string;
  name: string;
  blurb: string;
  meta: string;
  slots: SlotView[];
};

export type DayAvailability = {
  dayKey: string;
  timezone: string;
  durationMinutes: number;
  hourlyRateCents: number;
  totalCents: number;
  courts: CourtAvailability[];
};

type Interval = { start: Date; end: Date };

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Expire holds whose window has passed.
 *
 * This has to run before any availability read or booking write, because the
 * database's exclusion constraint treats every HELD row as occupying the court
 * — including one abandoned at the payment screen twenty minutes ago. Without
 * this sweep such a row would block the slot forever.
 */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.booking.updateMany({
    where: { status: 'HELD', holdExpiresAt: { lt: now } },
    data: { status: 'EXPIRED', holdExpiresAt: null },
  });
  return count;
}

/** Every start hour the venue offers, regardless of whether it is free. */
export function candidateStarts(settings: Pick<Settings, 'openHour' | 'closeHour'>): number[] {
  const starts: number[] = [];
  for (let hour = settings.openHour; hour < settings.closeHour; hour++) {
    starts.push(hour * 60);
  }
  return starts;
}

/** Durations that fit between a start time and closing. */
export function durationsFittingFrom(
  startMinutes: number,
  settings: Pick<Settings, 'closeHour' | 'durationsMinutes'>,
): number[] {
  return [...settings.durationsMinutes]
    .sort((a, b) => a - b)
    .filter((d) => startMinutes + d <= settings.closeHour * 60);
}

/**
 * Availability for one calendar day across every active court.
 *
 * Returned per court rather than for a single selected court so switching
 * courts in the booking UI is instant and cannot show a stale picture of one
 * court next to a fresh picture of another.
 */
export async function getDayAvailability(options: {
  dayKey: string;
  durationMinutes: number;
  now?: Date;
}): Promise<DayAvailability> {
  const { dayKey, durationMinutes } = options;
  const now = options.now ?? new Date();

  if (!isDayKey(dayKey)) throw new Error(`Not a day key: ${dayKey}`);

  const settings = await getSettings();
  const { timezone } = settings;

  if (!settings.durationsMinutes.includes(durationMinutes)) {
    throw new Error(`Unsupported duration: ${durationMinutes} minutes`);
  }

  await releaseExpiredHolds(now);

  // The venue day runs from local midnight to local midnight; a booking that
  // starts late may end after it, so the query window is widened by the
  // longest bookable block to catch anything spilling in from either side.
  const longestBlock = Math.max(...settings.durationsMinutes);
  const windowStart = addMinutes(venueInstant(dayKey, 0, timezone), -longestBlock);
  const windowEnd = addMinutes(venueInstant(dayKey, 24 * 60, timezone), longestBlock);

  const [courts, bookings, closures] = await Promise.all([
    prisma.court.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    }),
    prisma.booking.findMany({
      where: {
        status: { in: ['HELD', 'CONFIRMED'] },
        startsAt: { lt: windowEnd },
        endsAt: { gt: windowStart },
      },
      select: { courtId: true, startsAt: true, endsAt: true },
    }),
    prisma.closure.findMany({
      where: { startsAt: { lt: windowEnd }, endsAt: { gt: windowStart } },
      select: { courtId: true, startsAt: true, endsAt: true },
    }),
  ]);

  const bookedByCourt = new Map<string, Interval[]>();
  for (const b of bookings) {
    const list = bookedByCourt.get(b.courtId) ?? [];
    list.push({ start: b.startsAt, end: b.endsAt });
    bookedByCourt.set(b.courtId, list);
  }

  // A closure with a null courtId shuts the whole venue.
  const venueClosures: Interval[] = [];
  const closuresByCourt = new Map<string, Interval[]>();
  for (const c of closures) {
    const interval = { start: c.startsAt, end: c.endsAt };
    if (c.courtId === null) {
      venueClosures.push(interval);
    } else {
      const list = closuresByCourt.get(c.courtId) ?? [];
      list.push(interval);
      closuresByCourt.set(c.courtId, list);
    }
  }

  const starts = candidateStarts(settings);

  const courtViews: CourtAvailability[] = courts.map((court) => {
    const booked = bookedByCourt.get(court.id) ?? [];
    const closed = [...venueClosures, ...(closuresByCourt.get(court.id) ?? [])];

    const slots: SlotView[] = starts.map((startMinutes) => {
      const start = venueInstant(dayKey, startMinutes, timezone);
      const end = addMinutes(start, durationMinutes);
      const candidate = { start, end };
      const label = timeLabel(startMinutes);

      if (startMinutes + durationMinutes > settings.closeHour * 60) {
        return { startMinutes, label, available: false, reason: 'after-hours' };
      }
      if (start <= now) {
        return { startMinutes, label, available: false, reason: 'past' };
      }
      if (closed.some((c) => overlaps(candidate, c))) {
        return { startMinutes, label, available: false, reason: 'closed' };
      }
      if (booked.some((b) => overlaps(candidate, b))) {
        return { startMinutes, label, available: false, reason: 'booked' };
      }
      return { startMinutes, label, available: true, reason: null };
    });

    return {
      id: court.id,
      code: court.code,
      name: court.name,
      blurb: court.blurb,
      meta: court.meta,
      slots,
    };
  });

  return {
    dayKey,
    timezone,
    durationMinutes,
    hourlyRateCents: settings.hourlyRateCents,
    totalCents: priceFor(settings.hourlyRateCents, durationMinutes),
    courts: courtViews,
  };
}

/**
 * Whether one specific slot can still be taken.
 *
 * The booking writer calls this for a clear error message, but does not rely on
 * it for correctness — between this check and the insert another request can
 * win the slot. The database constraint is what actually decides.
 */
export async function checkSlot(options: {
  courtId: string;
  startsAt: Date;
  endsAt: Date;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; reason: SlotView['reason']; message: string }> {
  const now = options.now ?? new Date();
  const settings = await getSettings();
  const { timezone } = settings;

  if (options.endsAt <= options.startsAt) {
    return { ok: false, reason: null, message: 'A booking must last longer than zero minutes.' };
  }
  if (options.startsAt <= now) {
    return { ok: false, reason: 'past', message: 'That slot has already started.' };
  }

  const dayKey = dayKeyOf(options.startsAt, timezone);
  const opensAt = venueHour(dayKey, settings.openHour, timezone);
  const closesAt = venueHour(dayKey, settings.closeHour, timezone);
  if (options.startsAt < opensAt || options.endsAt > closesAt) {
    return {
      ok: false,
      reason: 'after-hours',
      message: `The venue is open ${timeLabel(settings.openHour * 60)} to ${timeLabel(settings.closeHour * 60)}.`,
    };
  }

  const court = await prisma.court.findUnique({ where: { id: options.courtId } });
  if (!court || !court.active) {
    return { ok: false, reason: null, message: 'That court is not available for booking.' };
  }

  await releaseExpiredHolds(now);

  const closure = await prisma.closure.findFirst({
    where: {
      OR: [{ courtId: options.courtId }, { courtId: null }],
      startsAt: { lt: options.endsAt },
      endsAt: { gt: options.startsAt },
    },
  });
  if (closure) {
    return { ok: false, reason: 'closed', message: `Court closed: ${closure.reason}.` };
  }

  const clash = await prisma.booking.findFirst({
    where: {
      courtId: options.courtId,
      status: { in: ['HELD', 'CONFIRMED'] },
      startsAt: { lt: options.endsAt },
      endsAt: { gt: options.startsAt },
    },
  });
  if (clash) {
    return { ok: false, reason: 'booked', message: 'That slot has just been taken.' };
  }

  return { ok: true };
}
