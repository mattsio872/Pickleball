import { describe, expect, it } from 'vitest';
import {
  dateLabel,
  dayKeyOf,
  isDayKey,
  minutesIntoDayOf,
  shiftDayKey,
  slotLabel,
  timeLabel,
  upcomingDayKeys,
  venueHour,
  venueInstant,
} from '@/lib/time';

const MANILA = 'Asia/Manila';

describe('venue-local instants', () => {
  it('maps a venue hour to the right UTC instant', () => {
    // Manila is UTC+8 year round.
    expect(venueHour('2026-09-10', 19, MANILA).toISOString()).toBe('2026-09-10T11:00:00.000Z');
    expect(venueHour('2026-09-10', 0, MANILA).toISOString()).toBe('2026-09-09T16:00:00.000Z');
  });

  it('handles half-hour offsets into the day', () => {
    expect(venueInstant('2026-09-10', 19 * 60 + 30, MANILA).toISOString()).toBe('2026-09-10T11:30:00.000Z');
  });

  it('rolls past midnight when the minutes exceed a day', () => {
    expect(venueInstant('2026-09-10', 24 * 60, MANILA).toISOString()).toBe('2026-09-10T16:00:00.000Z');
  });

  it('round-trips an instant back to its venue day', () => {
    // 00:30 Manila on the 11th is still the 10th in UTC — the day key must
    // follow the venue, not the server.
    const instant = new Date('2026-09-10T16:30:00.000Z');
    expect(dayKeyOf(instant, MANILA)).toBe('2026-09-11');
    expect(dayKeyOf(instant, 'UTC')).toBe('2026-09-10');
  });

  it('reports minutes into the venue day', () => {
    expect(minutesIntoDayOf(new Date('2026-09-10T11:00:00.000Z'), MANILA)).toBe(19 * 60);
    expect(minutesIntoDayOf(new Date('2026-09-10T11:30:00.000Z'), MANILA)).toBe(19 * 60 + 30);
  });

  it('survives a timezone that actually observes DST', () => {
    // New York moves to EST on 2026-11-01. 1AM local on the 2nd is unambiguous.
    const before = venueHour('2026-10-30', 12, 'America/New_York');
    const after = venueHour('2026-11-06', 12, 'America/New_York');
    expect(before.toISOString()).toBe('2026-10-30T16:00:00.000Z');
    expect(after.toISOString()).toBe('2026-11-06T17:00:00.000Z');
    // Noon local stays noon local across the change, which is the point.
    expect(minutesIntoDayOf(before, 'America/New_York')).toBe(720);
    expect(minutesIntoDayOf(after, 'America/New_York')).toBe(720);
  });
});

describe('day keys', () => {
  it('recognises the format', () => {
    expect(isDayKey('2026-09-10')).toBe(true);
    expect(isDayKey('2026-9-10')).toBe(false);
    expect(isDayKey('tomorrow')).toBe(false);
  });

  it('shifts by whole days in venue terms', () => {
    expect(shiftDayKey('2026-09-10', 1, MANILA)).toBe('2026-09-11');
    expect(shiftDayKey('2026-09-30', 1, MANILA)).toBe('2026-10-01');
    expect(shiftDayKey('2026-01-01', -1, MANILA)).toBe('2025-12-31');
  });

  it('lists consecutive upcoming days from the venue today', () => {
    const days = upcomingDayKeys(3, MANILA, new Date('2026-09-10T20:00:00.000Z')); // 4AM on the 11th
    expect(days).toEqual(['2026-09-11', '2026-09-12', '2026-09-13']);
  });
});

describe('labels', () => {
  it('formats times the way the design does', () => {
    expect(timeLabel(6 * 60)).toBe('6:00 AM');
    expect(timeLabel(12 * 60)).toBe('12:00 PM');
    expect(timeLabel(0)).toBe('12:00 AM');
    expect(timeLabel(19 * 60 + 30)).toBe('7:30 PM');
    expect(timeLabel(23 * 60)).toBe('11:00 PM');
  });

  it('wraps a time past midnight', () => {
    expect(timeLabel(24 * 60)).toBe('12:00 AM');
    expect(timeLabel(25 * 60)).toBe('1:00 AM');
  });

  it('formats dates and slots', () => {
    expect(dateLabel('2026-09-10', MANILA)).toBe('Thu, Sep 10');
    expect(
      slotLabel(new Date('2026-09-10T11:00:00.000Z'), new Date('2026-09-10T12:30:00.000Z'), MANILA),
    ).toBe('Thu, Sep 10 · 7:00 PM – 8:30 PM');
  });
});
