import { NextRequest, NextResponse } from 'next/server';
import { applyPaymentEvent } from '@/lib/checkout';
import { gateway } from '@/lib/payments';
import { handleError } from '@/lib/api';

// The signature covers the exact bytes received, so the body must be read raw
// and never parsed by anything upstream of the verification.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Payment provider callbacks — the only thing that confirms a booking.
 *
 * Response discipline matters here: a provider retries on any non-2xx, so we
 * return 200 for anything we have definitively dealt with (including events we
 * deliberately ignore and redeliveries we have already applied), and a non-2xx
 * only when a retry could genuinely help. A rejected signature returns 400 and
 * is never retried into success.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let event;
  try {
    event = await gateway().parseWebhook(rawBody, request.headers);
  } catch (error) {
    // Bad signature or malformed header: log and refuse, permanently.
    console.error('[webhook] Rejected:', error instanceof Error ? error.message : error);
    return handleError(error);
  }

  if (!event) {
    return NextResponse.json({ received: true, result: 'unrecognised' });
  }

  try {
    const outcome = await applyPaymentEvent(event);

    if (!outcome.handled) {
      // The event verified but we could not act on it. These need a human, not
      // a retry — acknowledged so the provider stops resending, and logged
      // loudly enough to be noticed.
      console.error(`[webhook] Needs attention: ${outcome.message}`);
      return NextResponse.json({ received: true, result: outcome.result, message: outcome.message });
    }

    return NextResponse.json({ received: true, result: outcome.result });
  } catch (error) {
    // A genuine failure on our side — let the provider retry.
    console.error('[webhook] Failed to apply event:', error);
    return NextResponse.json({ received: false, error: 'internal_error' }, { status: 500 });
  }
}
