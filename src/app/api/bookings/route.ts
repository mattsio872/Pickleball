import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHold } from '@/lib/booking';
import { getSettings } from '@/lib/settings';
import { isDayKey } from '@/lib/time';
import { route } from '@/lib/api';

export const dynamic = 'force-dynamic';

const body = z.object({
  courtId: z.string().min(1),
  date: z.string().refine(isDayKey, 'Expected a date as YYYY-MM-DD'),
  startMinutes: z.number().int().min(0).max(24 * 60),
  durationMinutes: z.number().int().positive(),
  name: z.string().trim().min(2, 'Please give the name the booking is under.').max(120),
  email: z.string().trim().email('That does not look like an email address.').max(200),
  mobile: z
    .string()
    .trim()
    .min(7, 'Please give a contactable mobile number.')
    .max(30)
    .regex(/^[0-9+()\-\s]+$/, 'Use digits, spaces, +, - and () only.'),
});

/**
 * Hold a slot.
 *
 * Nothing is charged here — the hold gives the booker a few minutes to pay
 * while keeping the court off the market. It lapses on its own if they stop.
 */
export const POST = route(async (request: NextRequest) => {
  const input = body.parse(await request.json());
  const settings = await getSettings();

  const booking = await createHold({
    courtId: input.courtId,
    dayKey: input.date,
    startMinutes: input.startMinutes,
    durationMinutes: input.durationMinutes,
    customerName: input.name,
    customerEmail: input.email,
    customerMobile: input.mobile,
  });

  return NextResponse.json(
    {
      id: booking.id,
      ref: booking.ref,
      court: { code: booking.court.code, name: booking.court.name },
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      totalCents: booking.totalCents,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
      holdMinutes: settings.holdMinutes,
    },
    { status: 201 },
  );
});
