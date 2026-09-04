import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import { PaymentError } from '../errors';
import type { CheckoutRequest, CheckoutSession, PaymentEvent, PaymentGateway } from './types';

/**
 * The gateway used when no PayMongo credentials are configured.
 *
 * It is not a stub that pretends to succeed: it redirects to a real local
 * checkout page where the outcome is chosen, and that page posts a signed
 * webhook back through the same endpoint PayMongo would use. The confirmation
 * path, the idempotency handling and the pass issuance are therefore the same
 * code in development as in production — only the counterparty changes.
 *
 * It cannot move money, and every screen that shows it says so.
 */
export class SandboxGateway implements PaymentGateway {
  readonly name = 'sandbox';
  readonly live = false;

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const id = `cs_sandbox_${randomBytes(12).toString('hex')}`;
    const params = new URLSearchParams({
      session: id,
      ref: request.bookingRef,
      booking: request.bookingId,
      amount: String(request.amountCents),
      method: request.method,
      success: request.successUrl,
      cancel: request.cancelUrl,
    });
    return { id, url: `/checkout/sandbox?${params.toString()}` };
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null> {
    const provided = headers.get('x-sandbox-signature');
    if (!provided) throw new PaymentError('Missing sandbox signature.');

    const expected = signSandbox(rawBody);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new PaymentError('Sandbox webhook signature did not verify.');
    }

    const body = JSON.parse(rawBody) as {
      eventId?: string;
      type?: string;
      bookingId?: string;
      bookingRef?: string;
      checkoutSessionId?: string;
      method?: string;
      amountCents?: number;
      outcome?: 'paid' | 'failed';
    };

    if (!body.eventId || !body.type) return null;

    return {
      eventId: body.eventId,
      type: body.type,
      checkoutSessionId: body.checkoutSessionId ?? null,
      bookingRef: body.bookingRef ?? null,
      bookingId: body.bookingId ?? null,
      providerPaymentId: `pay_sandbox_${body.eventId.slice(-12)}`,
      method: body.method ?? null,
      amountCents: body.amountCents ?? null,
      status: body.outcome === 'paid' ? 'paid' : 'failed',
    };
  }
}

/** Signs a sandbox webhook body with the app secret. Exported for the sandbox page. */
export function signSandbox(rawBody: string): string {
  return createHmac('sha256', env().APP_SECRET).update(`sandbox.v1.${rawBody}`).digest('hex');
}
