import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { startCheckout } from '@/lib/checkout';
import { isPaymentMethod } from '@/lib/payments';
import { route } from '@/lib/api';

export const dynamic = 'force-dynamic';

const body = z.object({
  bookingId: z.string().min(1),
  method: z.string().refine(isPaymentMethod, 'Unsupported payment method.'),
});

/** Opens a checkout session for a held booking and returns where to pay. */
export const POST = route(async (request: NextRequest) => {
  const input = body.parse(await request.json());
  const session = await startCheckout({
    bookingId: input.bookingId,
    method: input.method as Parameters<typeof startCheckout>[0]['method'],
  });
  return NextResponse.json(session);
});
