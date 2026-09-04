import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addMinutes as addMins } from 'date-fns';

/**
 * Everything about a booking is expressed in the venue's local time — "7PM on
 * the 10th" means 7PM in Quezon City regardless of where the booker is sitting
 * — but every instant is *stored* in UTC. These helpers are the only place the
 * two representations meet, so the conversion happens once and consistently.
 *
 * A "day key" is a venue-local calendar date as `YYYY-MM-DD`. It is the unit
 * the availability API and the date picker speak in.
 */

export const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: string): boolean {
  return DAY_KEY_RE.test(value);
}

/** The venue-local calendar date of an instant. */
export function dayKeyOf(instant: Date, timezone: string): string {
  return formatInTimeZone(instant, timezone, 'yyyy-MM-dd');
}

/** Today's date at the venue, which is not necessarily today where the server runs. */
export function todayKey(timezone: string, now: Date = new Date()): string {
  return dayKeyOf(now, timezone);
}

/**
 * The UTC instant of a venue-local wall-clock time.
 *
 * `minutesIntoDay` is measured from local midnight, so 19:30 is 1170. Values of
 * 1440 or more roll into the following day, which is how a booking that ends at
 * midnight is expressed.
 */
export function venueInstant(dayKey: string, minutesIntoDay: number, timezone: string): Date {
  if (!isDayKey(dayKey)) throw new Error(`Not a day key: ${dayKey}`);
  const dayStart = fromZonedTime(`${dayKey} 00:00:00`, timezone);
  return addMins(dayStart, minutesIntoDay);
}

/** The UTC instant of a venue-local hour, e.g. hour 19 on 2026-09-10. */
export function venueHour(dayKey: string, hour: number, timezone: string): Date {
  return venueInstant(dayKey, hour * 60, timezone);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return addMins(instant, minutes);
}

/** Day key `offset` days after `dayKey`, in venue-local terms. */
export function shiftDayKey(dayKey: string, offset: number, timezone: string): string {
  const noon = venueInstant(dayKey, 12 * 60 + offset * 24 * 60, timezone);
  return dayKeyOf(noon, timezone);
}

/** The next `count` day keys starting at the venue's today. */
export function upcomingDayKeys(count: number, timezone: string, now: Date = new Date()): string[] {
  const start = todayKey(timezone, now);
  return Array.from({ length: count }, (_, i) => shiftDayKey(start, i, timezone));
}

/** `7:00 PM`, matching the mockup's slot labels. */
export function timeLabel(minutesIntoDay: number): string {
  const total = ((minutesIntoDay % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** `Thu, Sep 10` — the booking summary's date line. */
export function dateLabel(dayKey: string, timezone: string): string {
  return formatInTimeZone(venueHour(dayKey, 12, timezone), timezone, 'EEE, MMM d');
}

/** `Thursday, 10 September 2026` — used in the pass email, where space allows. */
export function longDateLabel(dayKey: string, timezone: string): string {
  return formatInTimeZone(venueHour(dayKey, 12, timezone), timezone, 'EEEE, d MMMM yyyy');
}

/** Venue-local minutes into the day for a stored instant. */
export function minutesIntoDayOf(instant: Date, timezone: string): number {
  const local = toZonedTime(instant, timezone);
  return local.getHours() * 60 + local.getMinutes();
}

/** `Thu, Sep 10 · 7:00 PM – 8:30 PM`, for staff-facing screens. */
export function slotLabel(startsAt: Date, endsAt: Date, timezone: string): string {
  const day = dateLabel(dayKeyOf(startsAt, timezone), timezone);
  return `${day} · ${timeLabel(minutesIntoDayOf(startsAt, timezone))} – ${timeLabel(minutesIntoDayOf(endsAt, timezone))}`;
}

export function formatVenue(instant: Date, timezone: string, pattern: string): string {
  return formatInTimeZone(instant, timezone, pattern);
}

/** `1 hour`, `1.5 hours` — duration chips on the booking screen. */
export function durationLabel(minutes: number): string {
  const hours = minutes / 60;
  const rendered = Number.isInteger(hours) ? String(hours) : String(hours);
  return `${rendered} ${hours === 1 ? 'hour' : 'hours'}`;
}
