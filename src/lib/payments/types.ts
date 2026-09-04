/**
 * The payment surface the rest of the app talks to.
 *
 * Keeping it behind an interface means the booking flow does not know or care
 * whether a real gateway is configured — which is what lets the whole
 * reserve → pay → confirm → issue-pass path be exercised (and tested) before
 * anyone has a PayMongo account.
 */

/** Methods offered on the payment screen, mirroring the venue's cashless policy. */
export type PaymentMethod = 'gcash' | 'paymaya' | 'card' | 'dob';

export const PAYMENT_METHODS: {
  id: PaymentMethod;
  name: string;
  note: string;
  /** The value PayMongo expects in `payment_method_types`. */
  providerType: string;
}[] = [
  { id: 'gcash', name: 'GCash', note: 'e-wallet · instant', providerType: 'gcash' },
  { id: 'paymaya', name: 'Maya', note: 'e-wallet · instant', providerType: 'paymaya' },
  { id: 'dob', name: 'Online bank', note: 'InstaPay · PESONet', providerType: 'dob' },
  { id: 'card', name: 'Card', note: 'Visa · Mastercard', providerType: 'card' },
];

export function isPaymentMethod(value: string): value is PaymentMethod {
  return PAYMENT_METHODS.some((m) => m.id === value);
}

export function methodLabel(id: string): string {
  return PAYMENT_METHODS.find((m) => m.id === id)?.name ?? id;
}

export type CheckoutRequest = {
  bookingRef: string;
  bookingId: string;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  description: string;
  lineItemName: string;
  customerName: string;
  customerEmail: string;
  customerMobile: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSession = {
  /** Provider's identifier for the session, stored so webhooks can be matched. */
  id: string;
  /** Where the browser is sent to actually pay. */
  url: string;
};

/** A payment event distilled from a provider webhook. */
export type PaymentEvent = {
  /** Provider event id, used to make redelivery idempotent. */
  eventId: string;
  type: string;
  checkoutSessionId: string | null;
  bookingRef: string | null;
  bookingId: string | null;
  providerPaymentId: string | null;
  method: string | null;
  amountCents: number | null;
  status: 'paid' | 'failed' | 'ignored';
};

export interface PaymentGateway {
  readonly name: string;
  /** False when running the built-in sandbox, so the UI can say so plainly. */
  readonly live: boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Verifies the signature and distils the event. Returns null if not ours. */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>;
  refund?(providerPaymentId: string, amountCents: number, reason: string): Promise<void>;
}
