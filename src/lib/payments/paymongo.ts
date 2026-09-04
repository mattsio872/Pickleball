import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import { PaymentError } from '../errors';
import { PAYMENT_METHODS, type CheckoutRequest, type CheckoutSession, type PaymentEvent, type PaymentGateway } from './types';

/**
 * PayMongo hosted checkout.
 *
 * The customer picks their method on our own payment screen (as the design
 * intends), and the session is created with just that method so PayMongo's page
 * goes straight to it rather than asking a second time.
 *
 * Every channel used here must also be enabled on the merchant's PayMongo
 * dashboard; an unapproved channel is rejected at session-creation time with a
 * message this module surfaces verbatim.
 */

const API_BASE = 'https://api.paymongo.com/v1';

/** Events we act on. Anything else is acknowledged and ignored. */
const PAID_EVENTS = new Set(['checkout_session.payment.paid', 'payment.paid']);
const FAILED_EVENTS = new Set(['payment.failed']);

function authHeader(): string {
  // PayMongo uses HTTP Basic with the secret key as the username and no password.
  return `Basic ${Buffer.from(`${env().PAYMONGO_SECRET_KEY}:`).toString('base64')}`;
}

type PayMongoError = { detail?: string; code?: string };

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (cause) {
    throw new PaymentError('Could not reach the payment provider. Please try again.');
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new PaymentError(`Payment provider returned an unreadable response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const errors = (body as { errors?: PayMongoError[] }).errors ?? [];
    const detail = errors.map((e) => e.detail).filter(Boolean).join('; ');
    throw new PaymentError(detail || `Payment provider rejected the request (HTTP ${response.status}).`);
  }
  return body as T;
}

type CheckoutSessionResponse = {
  data: { id: string; attributes: { checkout_url: string } };
};

export class PayMongoGateway implements PaymentGateway {
  readonly name = 'paymongo';
  readonly live = true;

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const providerType =
      PAYMENT_METHODS.find((m) => m.id === request.method)?.providerType ?? request.method;

    const payload = {
      data: {
        attributes: {
          line_items: [
            {
              name: request.lineItemName,
              quantity: 1,
              amount: request.amountCents,
              currency: request.currency,
              description: request.description,
            },
          ],
          payment_method_types: [providerType],
          description: request.description,
          // Shown on the PayMongo receipt and in the merchant dashboard, which
          // is how a payment is traced back to a booking by hand if needed.
          reference_number: request.bookingRef,
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          billing: {
            name: request.customerName,
            email: request.customerEmail,
            phone: request.customerMobile,
          },
          // Echoed back on the webhook, so the event can be tied to a booking
          // without depending on the reference number surviving round-trip.
          metadata: {
            bookingId: request.bookingId,
            bookingRef: request.bookingRef,
          },
        },
      },
    };

    const result = await call<CheckoutSessionResponse>('/checkout_sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!result.data?.id || !result.data.attributes?.checkout_url) {
      throw new PaymentError('Payment provider did not return a checkout URL.');
    }
    return { id: result.data.id, url: result.data.attributes.checkout_url };
  }

  /**
   * Verify the `Paymongo-Signature` header and distil the event.
   *
   * The header looks like `t=<unix>,te=<test sig>,li=<live sig>`; the signed
   * string is `<t>.<raw body>` under HMAC-SHA256 with the webhook secret. The
   * body must be the exact bytes received — re-serialising parsed JSON changes
   * key order and whitespace and breaks verification on legitimate requests.
   */
  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null> {
    const header = headers.get('paymongo-signature');
    if (!header) throw new PaymentError('Missing Paymongo-Signature header.');
    if (!env().PAYMONGO_WEBHOOK_SECRET) {
      throw new PaymentError('PAYMONGO_WEBHOOK_SECRET is not configured; refusing to trust the webhook.');
    }

    const parts = new Map<string, string>();
    for (const segment of header.split(',')) {
      const [key, value] = segment.split('=');
      if (key && value) parts.set(key.trim(), value.trim());
    }

    const timestamp = parts.get('t');
    // Test-mode deliveries sign into `te`, live-mode into `li`. Whichever the
    // dashboard sent, exactly one will match a correctly computed signature.
    const candidates = [parts.get('te'), parts.get('li')].filter(Boolean) as string[];
    if (!timestamp || candidates.length === 0) {
      throw new PaymentError('Malformed Paymongo-Signature header.');
    }

    const expected = createHmac('sha256', env().PAYMONGO_WEBHOOK_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const matched = candidates.some((candidate) => {
      const a = Buffer.from(candidate, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (!matched) throw new PaymentError('Webhook signature did not verify.');

    return distil(JSON.parse(rawBody));
  }

  async refund(providerPaymentId: string, amountCents: number, reason: string): Promise<void> {
    await call('/refunds', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          attributes: {
            amount: amountCents,
            payment_id: providerPaymentId,
            // PayMongo accepts a fixed set of reason codes.
            reason: 'others',
            notes: reason.slice(0, 255),
          },
        },
      }),
    });
  }
}

type WebhookBody = {
  data?: {
    id?: string;
    attributes?: {
      type?: string;
      data?: {
        id?: string;
        attributes?: Record<string, unknown>;
      };
    };
  };
};

/** Pull the few fields we need out of PayMongo's nested event envelope. */
export function distil(body: WebhookBody): PaymentEvent | null {
  const eventId = body.data?.id;
  const type = body.data?.attributes?.type;
  if (!eventId || !type) return null;

  const resource = body.data?.attributes?.data;
  const attrs = (resource?.attributes ?? {}) as Record<string, unknown>;

  const status: PaymentEvent['status'] = PAID_EVENTS.has(type)
    ? 'paid'
    : FAILED_EVENTS.has(type)
      ? 'failed'
      : 'ignored';

  // A checkout_session.* event carries the session; a payment.* event carries
  // the payment and names its session in the payment's own attributes.
  const isSessionEvent = type.startsWith('checkout_session.');
  const payments = (attrs.payments as Array<{ id?: string; attributes?: Record<string, unknown> }> | undefined) ?? [];
  const firstPayment = payments[0];
  const paymentAttrs = (isSessionEvent ? firstPayment?.attributes : attrs) ?? {};

  const metadata = (attrs.metadata ?? paymentAttrs.metadata ?? {}) as Record<string, unknown>;
  const source = paymentAttrs.source as { type?: string } | undefined;

  return {
    eventId,
    type,
    checkoutSessionId: isSessionEvent
      ? (resource?.id ?? null)
      : ((paymentAttrs.checkout_session_id as string | undefined) ?? null),
    bookingRef:
      (metadata.bookingRef as string | undefined) ??
      (attrs.reference_number as string | undefined) ??
      null,
    bookingId: (metadata.bookingId as string | undefined) ?? null,
    providerPaymentId: isSessionEvent ? (firstPayment?.id ?? null) : (resource?.id ?? null),
    method:
      source?.type ??
      (paymentAttrs.payment_method_used as string | undefined) ??
      null,
    amountCents: typeof paymentAttrs.amount === 'number' ? paymentAttrs.amount : null,
    status,
  };
}
