import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createHold } from '@/lib/booking';
import { applyPaymentEvent, startCheckout } from '@/lib/checkout';
import { gateway, type PaymentEvent } from '@/lib/payments';
import { distil } from '@/lib/payments/paymongo';
import { migrateTestDatabase, resetDatabase, seedVenue, NOW, TEST_DAY } from './helpers';

let courtId: string;
const customer = {
  customerName: 'Juan dela Cruz',
  customerEmail: 'juan@example.com',
  customerMobile: '0917 555 0134',
};

beforeAll(() => migrateTestDatabase());
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  const { courts } = await seedVenue();
  courtId = courts[0].id;
  vi.restoreAllMocks();
});

async function heldBooking(startHour = 19) {
  return createHold(
    { courtId, dayKey: TEST_DAY, startMinutes: startHour * 60, durationMinutes: 60, ...customer },
    NOW,
  );
}

function paidEvent(overrides: Partial<PaymentEvent> & { eventId: string }): PaymentEvent {
  return {
    type: 'checkout_session.payment.paid',
    checkoutSessionId: null,
    bookingRef: null,
    bookingId: null,
    providerPaymentId: 'pay_test_1',
    method: 'gcash',
    amountCents: 65000,
    status: 'paid',
    ...overrides,
  };
}

describe('startCheckout', () => {
  it('creates a pending payment against the booking', async () => {
    const booking = await heldBooking();
    const session = await startCheckout({ bookingId: booking.id, method: 'gcash' });

    expect(session.checkoutUrl).toContain('/checkout/sandbox');
    expect(session.live).toBe(false);

    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe('PENDING');
    expect(payment.amountCents).toBe(65000);
    expect(payment.checkoutSessionId).toBe(session.sessionId);
  });

  it('refuses to charge for a booking that is already paid', async () => {
    const booking = await heldBooking();
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });
    await expect(startCheckout({ bookingId: booking.id, method: 'gcash' })).rejects.toThrow(/already paid/i);
  });

  it('refuses a booking whose hold has lapsed', async () => {
    const booking = await heldBooking();
    await prisma.booking.update({
      where: { id: booking.id },
      data: { holdExpiresAt: new Date('2020-01-01T00:00:00Z') },
    });
    await expect(startCheckout({ bookingId: booking.id, method: 'gcash' })).rejects.toThrow(/expired/i);
  });
});

describe('applyPaymentEvent', () => {
  it('confirms the booking and records the payment', async () => {
    const booking = await heldBooking();
    const session = await startCheckout({ bookingId: booking.id, method: 'gcash' });

    const outcome = await applyPaymentEvent(
      paidEvent({ eventId: 'evt_1', checkoutSessionId: session.sessionId, bookingId: booking.id }),
    );

    expect(outcome).toEqual({ handled: true, result: 'confirmed' });

    const reread = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reread.status).toBe('CONFIRMED');
    expect(reread.holdExpiresAt).toBeNull();

    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe('PAID');
    expect(payment.providerPaymentId).toBe('pay_test_1');
    expect(payment.paidAt).not.toBeNull();
  });

  it('treats a redelivered event as a no-op', async () => {
    const booking = await heldBooking();
    const session = await startCheckout({ bookingId: booking.id, method: 'gcash' });
    const event = paidEvent({ eventId: 'evt_same', checkoutSessionId: session.sessionId, bookingId: booking.id });

    expect(await applyPaymentEvent(event)).toEqual({ handled: true, result: 'confirmed' });
    expect(await applyPaymentEvent(event)).toEqual({ handled: true, result: 'duplicate' });
    expect(await applyPaymentEvent(event)).toEqual({ handled: true, result: 'duplicate' });

    expect(await prisma.webhookEvent.count()).toBe(1);
  });

  it('matches a booking by reference when no metadata survives', async () => {
    const booking = await heldBooking();
    await startCheckout({ bookingId: booking.id, method: 'gcash' });

    const outcome = await applyPaymentEvent(paidEvent({ eventId: 'evt_ref', bookingRef: booking.ref }));
    expect(outcome).toEqual({ handled: true, result: 'confirmed' });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED');
  });

  it('records a failed payment without confirming', async () => {
    const booking = await heldBooking();
    const session = await startCheckout({ bookingId: booking.id, method: 'gcash' });

    const outcome = await applyPaymentEvent(
      paidEvent({
        eventId: 'evt_fail',
        type: 'payment.failed',
        status: 'failed',
        checkoutSessionId: session.sessionId,
        bookingId: booking.id,
      }),
    );

    expect(outcome).toEqual({ handled: true, result: 'failed' });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('HELD');
    expect((await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } })).status).toBe('FAILED');
  });

  it('ignores event types it does not act on', async () => {
    const outcome = await applyPaymentEvent(
      paidEvent({ eventId: 'evt_noise', type: 'source.chargeable', status: 'ignored' }),
    );
    expect(outcome).toEqual({ handled: true, result: 'ignored' });
  });

  it('reports an event that matches no booking', async () => {
    const outcome = await applyPaymentEvent(paidEvent({ eventId: 'evt_orphan', bookingRef: 'PL-ZZZZZZ' }));
    expect(outcome.handled).toBe(false);
    expect(outcome.result).toBe('unmatched');
  });

  it('flags a payment that arrives after the slot was lost, for refund', async () => {
    const booking = await heldBooking();
    const session = await startCheckout({ bookingId: booking.id, method: 'gcash' });

    // The hold lapses and somebody else takes the court.
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'EXPIRED', holdExpiresAt: null },
    });
    await createHold(
      { courtId, dayKey: TEST_DAY, startMinutes: 19 * 60, durationMinutes: 60, ...customer, customerEmail: 'other@example.com' },
      NOW,
    );

    const outcome = await applyPaymentEvent(
      paidEvent({ eventId: 'evt_late', checkoutSessionId: session.sessionId, bookingId: booking.id }),
    );

    expect(outcome.handled).toBe(false);
    expect(outcome.result).toBe('slot_lost');
    if (!outcome.handled) expect(outcome.message).toMatch(/Refund/);

    // The money is recorded as taken, so it can actually be given back.
    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(payment.status).toBe('PAID');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('EXPIRED');
  });

  it('emails the pass exactly once, on the transition to confirmed', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const booking = await heldBooking();
    const session = await startCheckout({ bookingId: booking.id, method: 'gcash' });

    await applyPaymentEvent(paidEvent({ eventId: 'evt_a', checkoutSessionId: session.sessionId, bookingId: booking.id }));
    await applyPaymentEvent(paidEvent({ eventId: 'evt_b', checkoutSessionId: session.sessionId, bookingId: booking.id }));
    await applyPaymentEvent(paidEvent({ eventId: 'evt_c', checkoutSessionId: session.sessionId, bookingId: booking.id }));

    const passLogs = log.mock.calls.filter((c) => String(c[0]).includes('entry pass'));
    expect(passLogs).toHaveLength(1);
  });
});

describe('sandbox webhook signing', () => {
  it('accepts a correctly signed body and rejects everything else', async () => {
    const pay = gateway();
    const body = JSON.stringify({ eventId: 'evt_sig', type: 'checkout_session.payment.paid', outcome: 'paid' });
    const signature = createHmac('sha256', process.env.APP_SECRET!).update(`sandbox.v1.${body}`).digest('hex');

    const good = await pay.parseWebhook(body, new Headers({ 'x-sandbox-signature': signature }));
    expect(good?.eventId).toBe('evt_sig');

    await expect(pay.parseWebhook(body, new Headers({ 'x-sandbox-signature': 'f'.repeat(64) }))).rejects.toThrow(
      /did not verify/,
    );
    await expect(pay.parseWebhook(body, new Headers())).rejects.toThrow(/Missing sandbox signature/);
    // A changed body must invalidate the signature.
    await expect(
      pay.parseWebhook(body.replace('paid', 'fail'), new Headers({ 'x-sandbox-signature': signature })),
    ).rejects.toThrow(/did not verify/);
  });
});

describe('PayMongo event parsing', () => {
  it('reads a checkout_session.payment.paid envelope', () => {
    const event = distil({
      data: {
        id: 'evt_abc',
        attributes: {
          type: 'checkout_session.payment.paid',
          data: {
            id: 'cs_123',
            attributes: {
              reference_number: 'PL-K7Q2M9',
              metadata: { bookingId: 'bk_1', bookingRef: 'PL-K7Q2M9' },
              payments: [
                { id: 'pay_999', attributes: { status: 'paid', amount: 65000, source: { type: 'gcash' } } },
              ],
            },
          },
        },
      },
    });

    expect(event).toMatchObject({
      eventId: 'evt_abc',
      type: 'checkout_session.payment.paid',
      checkoutSessionId: 'cs_123',
      bookingRef: 'PL-K7Q2M9',
      bookingId: 'bk_1',
      providerPaymentId: 'pay_999',
      method: 'gcash',
      amountCents: 65000,
      status: 'paid',
    });
  });

  it('reads a payment.failed envelope', () => {
    const event = distil({
      data: {
        id: 'evt_def',
        attributes: {
          type: 'payment.failed',
          data: {
            id: 'pay_777',
            attributes: {
              amount: 65000,
              checkout_session_id: 'cs_456',
              source: { type: 'paymaya' },
              metadata: { bookingId: 'bk_2' },
            },
          },
        },
      },
    });

    expect(event).toMatchObject({
      eventId: 'evt_def',
      checkoutSessionId: 'cs_456',
      providerPaymentId: 'pay_777',
      method: 'paymaya',
      status: 'failed',
    });
  });

  it('classifies unrelated event types as ignorable', () => {
    const event = distil({
      data: { id: 'evt_x', attributes: { type: 'source.chargeable', data: { id: 'src_1', attributes: {} } } },
    });
    expect(event?.status).toBe('ignored');
  });

  it('returns null for an envelope with no event', () => {
    expect(distil({})).toBeNull();
    expect(distil({ data: { id: 'evt_only' } })).toBeNull();
  });
});
