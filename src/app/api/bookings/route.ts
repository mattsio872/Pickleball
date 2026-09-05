import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHold } from '@/lib/booking';
import { getSettings } from '@/lib/settings';
import { isDayKey } from '@/lib/time';
import { currentCustomer } from '@/lib/customer-auth';
import { saveBookingDetails } from '@/lib/customers';
import { route } from '@/lib/api';
import { AuthError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const body = z.object({
  courtId: z.string().min(1),
  date: z.string().refine(isDayKey, 'Expected a date as YYYY-MM-DD'),
  startMinutes: z.number().int().min(0).max(24 * 60),
  durationMinutes: z.number().int().positive(),
  name: z.string().trim().min(2, 'Please give the name the booking is under.').max(120),
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
 *
 * Booking requires an account. The gate is here rather than only on the page,
 * because the page can be bypassed and this cannot: every booking made through
 * the site belongs to somebody who can come back and find it.
 */
export const POST = route(async (request: NextRequest) => {
  const customer = await currentCustomer();
  if (!customer) {
    throw new AuthError('Please sign in to book a court — your booking is saved to your account.');
  }

  const input = body.parse(await request.json());
  const settings = await getSettings();

  // The booking is made against the account's own email whatever the form
  // says, so a booking can never land in an account under somebody else's
  // address; the name and number on it are kept for next time.
  await saveBookingDetails(customer.customerId, { name: input.name, mobile: input.mobile });

  const booking = await createHold({
    courtId: input.courtId,
    dayKey: input.date,
    startMinutes: input.startMinutes,
    durationMinutes: input.durationMinutes,
    customerName: input.name,
    customerEmail: customer.email,
    customerMobile: input.mobile,
    customerId: customer.customerId,
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
