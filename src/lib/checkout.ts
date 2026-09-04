import { prisma } from './db';
import { siteUrl } from './env';
import { getSettings } from './settings';
import { confirmBooking } from './booking';
import { sendPassEmail } from './email';
import { makePassToken } from './pass';
import { gateway, methodLabel, type PaymentEvent, type PaymentMethod } from './payments';
import { AppError, NotFoundError, ValidationError } from './errors';
import { slotLabel } from './time';
import { formatPeso } from './money';

/**
 * The bridge between a held booking and the payment provider.
 *
 * Two rules shape this module:
 *
 *  1. A booking becomes CONFIRMED only in response to a verified provider
 *     event — never because the browser came back to the success URL. The
 *     redirect is a navigation hint; a user can visit it by hand.
 *  2. Applying an event is idempotent. Providers retry webhooks, sometimes for
 *     days, and a party must not be emailed four passes because of it.
 */

export async function startCheckout(options: {
  bookingId: string;
  method: PaymentMethod;
}): Promise<{ checkoutUrl: string; sessionId: string; live: boolean }> {
  const booking = await prisma.booking.findUnique({
    where: { id: options.bookingId },
    include: { court: true },
  });
  if (!booking) throw new NotFoundError('That booking no longer exists.');
  if (booking.status === 'CONFIRMED') {
    throw new ValidationError('This booking is already paid.');
  }
  if (booking.status !== 'HELD') {
    throw new ValidationError('This booking has expired. Please pick a slot again.');
  }
  if (booking.holdExpiresAt && booking.holdExpiresAt < new Date()) {
    throw new ValidationError('Your hold has expired. Please pick a slot again.');
  }

  const settings = await getSettings();
  const pay = gateway();
  const slot = slotLabel(booking.startsAt, booking.endsAt, settings.timezone);
  const passToken = makePassToken(booking);

  const session = await pay.createCheckout({
    bookingId: booking.id,
    bookingRef: booking.ref,
    amountCents: booking.totalCents,
    currency: booking.currency,
    method: options.method,
    lineItemName: `Court ${booking.court.code} · ${booking.court.name}`,
    description: `${settings.venueName} — ${slot}`,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    customerMobile: booking.customerMobile,
    successUrl: `${siteUrl}/pass/${encodeURIComponent(passToken)}?just_paid=1`,
    cancelUrl: `${siteUrl}/book?cancelled=${booking.ref}`,
  });

  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      provider: pay.name,
      checkoutSessionId: session.id,
      method: options.method,
      amountCents: booking.totalCents,
      currency: booking.currency,
      status: 'PENDING',
      checkoutUrl: session.url,
    },
  });

  return { checkoutUrl: session.url, sessionId: session.id, live: pay.live };
}

export type EventOutcome =
  | { handled: true; result: 'confirmed' | 'already_confirmed' | 'failed' | 'ignored' | 'duplicate' }
  | { handled: false; result: 'unmatched' | 'slot_lost'; message: string };

/**
 * Apply a verified provider event.
 *
 * The event is recorded first, under a unique constraint on (provider, eventId).
 * A redelivery therefore collides and returns early, before anything is
 * confirmed or emailed a second time.
 */
export async function applyPaymentEvent(event: PaymentEvent): Promise<EventOutcome> {
  const pay = gateway();

  try {
    await prisma.webhookEvent.create({
      data: {
        provider: pay.name,
        eventId: event.eventId,
        type: event.type,
        payload: event as unknown as object,
      },
    });
  } catch {
    // Unique violation: we have already processed this event.
    return { handled: true, result: 'duplicate' };
  }

  if (event.status === 'ignored') return { handled: true, result: 'ignored' };

  const payment = await findPayment(event);
  const booking = await findBooking(event, payment?.bookingId ?? null);

  if (!booking) {
    return {
      handled: false,
      result: 'unmatched',
      message: `Event ${event.eventId} (${event.type}) did not match a booking.`,
    };
  }

  if (event.status === 'failed') {
    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', raw: event as unknown as object },
      });
    }
    return { handled: true, result: 'failed' };
  }

  // Paid. Guard against a provider charging a different amount than we asked.
  if (event.amountCents !== null && event.amountCents !== booking.totalCents) {
    console.error(
      `[payments] Amount mismatch on ${booking.ref}: charged ${event.amountCents}, expected ${booking.totalCents}.`,
    );
  }

  const confirmation = await confirmBooking(booking.id);

  if (!confirmation.ok) {
    if (confirmation.reason === 'slot_lost') {
      // Paid for a court that is no longer theirs. Flag loudly and leave the
      // payment recorded so it can be refunded.
      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'PAID',
            providerPaymentId: event.providerPaymentId,
            method: event.method ?? payment.method,
            paidAt: new Date(),
            raw: event as unknown as object,
          },
        });
      }
      const message =
        `Booking ${booking.ref} was paid (${formatPeso(booking.totalCents)}) but its hold had lapsed and ` +
        `the slot was taken. Refund ${event.providerPaymentId ?? 'the payment'} and contact ${booking.customerEmail}.`;
      console.error(`[payments] ${message}`);
      return { handled: false, result: 'slot_lost', message };
    }
    return {
      handled: false,
      result: 'unmatched',
      message: `Booking ${booking.ref} could not be confirmed (${confirmation.reason}).`,
    };
  }

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        providerPaymentId: event.providerPaymentId,
        method: event.method ?? payment.method,
        paidAt: new Date(),
        raw: event as unknown as object,
      },
    });
  }

  if (confirmation.alreadyConfirmed) {
    return { handled: true, result: 'already_confirmed' };
  }

  // Email only on the transition into CONFIRMED, so a retried webhook that
  // finds the booking already confirmed does not send a second pass.
  const settings = await getSettings();
  const sent = await sendPassEmail({
    booking: confirmation.booking,
    venueName: settings.venueName,
    city: settings.city,
    timezone: settings.timezone,
    contactViber: settings.contactViber,
    cancellationHours: settings.cancellationHours,
  });
  if (sent.sent) {
    await prisma.booking.update({
      where: { id: confirmation.booking.id },
      data: { passEmailedAt: new Date() },
    });
  }

  return { handled: true, result: 'confirmed' };
}

async function findPayment(event: PaymentEvent) {
  if (event.checkoutSessionId) {
    const bySession = await prisma.payment.findUnique({
      where: { checkoutSessionId: event.checkoutSessionId },
    });
    if (bySession) return bySession;
  }
  if (event.bookingId) {
    return prisma.payment.findFirst({
      where: { bookingId: event.bookingId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }
  return null;
}

async function findBooking(event: PaymentEvent, paymentBookingId: string | null) {
  const id = paymentBookingId ?? event.bookingId;
  if (id) {
    const byId = await prisma.booking.findUnique({ where: { id } });
    if (byId) return byId;
  }
  if (event.bookingRef) {
    return prisma.booking.findUnique({ where: { ref: event.bookingRef } });
  }
  return null;
}

export { methodLabel, AppError };
