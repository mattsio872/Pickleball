import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { paymentsLive, siteUrl } from '@/lib/env';
import { signSandbox } from '@/lib/payments';
import { route } from '@/lib/api';
import { ForbiddenError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  bookingId: z.string().min(1),
  bookingRef: z.string().min(1),
  checkoutSessionId: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  method: z.string().min(1),
  outcome: z.enum(['paid', 'failed']),
});

/**
 * Stands in for the provider's own servers in sandbox mode.
 *
 * It signs a webhook body and posts it to the real webhook endpoint, so the
 * confirmation path being exercised locally is the same code that will run when
 * PayMongo calls in. Disabled outright once real credentials are present.
 */
export const POST = route(async (request: NextRequest) => {
  if (paymentsLive()) {
    throw new ForbiddenError('The sandbox gateway is disabled because PayMongo credentials are configured.');
  }

  const input = body.parse(await request.json());
  const payload = JSON.stringify({
    eventId: `evt_sandbox_${randomUUID()}`,
    type: input.outcome === 'paid' ? 'checkout_session.payment.paid' : 'payment.failed',
    ...input,
  });

  const response = await fetch(`${siteUrl()}/api/webhooks/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sandbox-signature': signSandbox(payload) },
    body: payload,
  });

  return NextResponse.json(await response.json(), { status: response.status });
});
