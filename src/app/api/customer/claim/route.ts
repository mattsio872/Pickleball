import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { claimBooking, requireCustomer } from '@/lib/customer-auth';
import { route } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({ ref: z.string().trim().min(3, 'Enter the booking reference.').max(20) });

/**
 * Attach a booking made before the account existed.
 *
 * The reference proves ownership — it was emailed to the booker and printed on
 * their pass, and is not guessable — so this works without a verified email
 * address and cannot be used to read somebody else's history.
 */
export const POST = route(async (request: NextRequest) => {
  const session = await requireCustomer();
  const input = body.parse(await request.json());
  const booking = await claimBooking(session.customerId, input.ref);
  return NextResponse.json({ ref: booking.ref, court: `Court ${booking.court.code} · ${booking.court.name}` });
});
