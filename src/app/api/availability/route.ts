import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDayAvailability } from '@/lib/availability';
import { getSettings, toPublicSettings } from '@/lib/settings';
import { upcomingDayKeys, isDayKey } from '@/lib/time';
import { route } from '@/lib/api';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const query = z.object({
  date: z.string().refine(isDayKey, 'Expected a date as YYYY-MM-DD'),
  duration: z.coerce.number().int().positive(),
});

/** Live availability for one day, across every active court. */
export const GET = route(async (request: NextRequest) => {
  const settings = await getSettings();
  const params = request.nextUrl.searchParams;

  const parsed = query.parse({
    date: params.get('date') ?? upcomingDayKeys(1, settings.timezone)[0],
    duration: params.get('duration') ?? settings.durationsMinutes[0],
  });

  if (!settings.durationsMinutes.includes(parsed.duration)) {
    throw new ValidationError(`We do not offer ${parsed.duration}-minute blocks.`);
  }

  const availability = await getDayAvailability({
    dayKey: parsed.date,
    durationMinutes: parsed.duration,
  });

  return NextResponse.json({
    ...availability,
    settings: toPublicSettings(settings),
    days: upcomingDayKeys(14, settings.timezone),
  });
});
