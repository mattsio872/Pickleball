import { prisma } from './db';
import { getSettings } from './settings';
import { addMinutes, dayKeyOf, shiftDayKey, timeLabel, venueInstant, isDayKey } from './time';

/**
 * A week of the venue's bookings, as a grid.
 *
 * Reading availability as a customer answers "can I have this slot"; running a
 * venue asks "what does Thursday look like", which needs every court and every
 * hour at once. Built from the same bookings, so the two can never disagree.
 */

export type ScheduleCell = {
  /** Minutes from venue-local midnight. */
  startMinutes: number;
  label: string;
  bookings: {
    ref: string;
    courtId: string;
    courtCode: string;
    customerName: string;
    players: number;
    status: 'HELD' | 'CONFIRMED';
    /** True on the hour the booking begins, false for the hours it runs into. */
    isStart: boolean;
    hours: number;
  }[];
  closed: boolean;
};

export type ScheduleDay = {
  dayKey: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
  cells: ScheduleCell[];
};

export type WeekSchedule = {
  weekStart: string;
  weekEnd: string;
  previousWeek: string;
  nextWeek: string;
  timezone: string;
  hours: number[];
  courts: { id: string; code: string; name: string }[];
  days: ScheduleDay[];
  totals: { bookings: number; hoursBooked: number; revenueCents: number };
};

/** Monday of the week containing `dayKey`. */
export function weekStartOf(dayKey: string, timezone: string): string {
  const noon = venueInstant(dayKey, 12 * 60, timezone);
  // getUTCDay on a noon-local instant is safe: noon never straddles a date line
  // for any real timezone offset.
  const local = new Date(noon.toLocaleString('en-US', { timeZone: timezone }));
  const weekday = (local.getDay() + 6) % 7; // Monday = 0
  return shiftDayKey(dayKey, -weekday, timezone);
}

export async function getWeekSchedule(options: { weekOf?: string; now?: Date } = {}): Promise<WeekSchedule> {
  const now = options.now ?? new Date();
  const settings = await getSettings();
  const { timezone } = settings;

  const anchor = options.weekOf && isDayKey(options.weekOf) ? options.weekOf : dayKeyOf(now, timezone);
  const weekStart = weekStartOf(anchor, timezone);
  const dayKeys = Array.from({ length: 7 }, (_, i) => shiftDayKey(weekStart, i, timezone));

  const windowStart = venueInstant(weekStart, 0, timezone);
  const windowEnd = venueInstant(dayKeys[6], 24 * 60, timezone);

  const [courts, bookings, closures] = await Promise.all([
    prisma.court.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
    prisma.booking.findMany({
      where: {
        status: { in: ['HELD', 'CONFIRMED'] },
        startsAt: { lt: windowEnd },
        endsAt: { gt: windowStart },
      },
      include: { court: true, players: true },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.closure.findMany({
      where: { startsAt: { lt: windowEnd }, endsAt: { gt: windowStart } },
    }),
  ]);

  const hours: number[] = [];
  for (let h = settings.openHour; h < settings.closeHour; h++) hours.push(h);

  const today = dayKeyOf(now, timezone);

  const days: ScheduleDay[] = dayKeys.map((dayKey) => {
    const cells: ScheduleCell[] = hours.map((hour) => {
      const cellStart = venueInstant(dayKey, hour * 60, timezone);
      const cellEnd = addMinutes(cellStart, 60);

      const overlapping = bookings.filter((b) => b.startsAt < cellEnd && b.endsAt > cellStart);
      const closed = closures.some((c) => c.startsAt < cellEnd && c.endsAt > cellStart && c.courtId === null);

      return {
        startMinutes: hour * 60,
        label: timeLabel(hour * 60),
        closed,
        bookings: overlapping.map((b) => ({
          ref: b.ref,
          courtId: b.courtId,
          courtCode: b.court.code,
          customerName: b.customerName,
          players: b.players.length,
          status: b.status as 'HELD' | 'CONFIRMED',
          isStart: b.startsAt.getTime() === cellStart.getTime(),
          hours: Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 3_600_000),
        })),
      };
    });

    const local = new Date(venueInstant(dayKey, 12 * 60, timezone).toLocaleString('en-US', { timeZone: timezone }));

    return {
      dayKey,
      weekday: local.toLocaleDateString('en-PH', { weekday: 'short' }),
      dayOfMonth: local.getDate(),
      isToday: dayKey === today,
      cells,
    };
  });

  const confirmed = bookings.filter((b) => b.status === 'CONFIRMED');

  return {
    weekStart,
    weekEnd: dayKeys[6],
    previousWeek: shiftDayKey(weekStart, -7, timezone),
    nextWeek: shiftDayKey(weekStart, 7, timezone),
    timezone,
    hours,
    courts: courts.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    days,
    totals: {
      bookings: bookings.length,
      hoursBooked: bookings.reduce((sum, b) => sum + (b.endsAt.getTime() - b.startsAt.getTime()) / 3_600_000, 0),
      revenueCents: confirmed.reduce((sum, b) => sum + b.totalCents, 0),
    },
  };
}
