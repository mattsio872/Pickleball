import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth';
import { verifyPassToken } from '@/lib/pass';
import { findByRefWithParty, normaliseRef } from '@/lib/booking';
import { getSettings } from '@/lib/settings';
import { prisma } from '@/lib/db';
import { slotLabel } from '@/lib/time';
import { formatPeso } from '@/lib/money';
import { methodLabel } from '@/lib/payments';
import { route } from '@/lib/api';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z
  .object({ token: z.string().optional(), ref: z.string().optional() })
  .refine((v) => v.token || v.ref, 'Scan a pass or enter a reference.');

/**
 * What the desk sees when a pass is scanned or a reference keyed in.
 *
 * The booking's court, slot and payment status come from the database, never
 * from the pass — so a pass that has been tampered with fails the signature
 * check, and a genuine pass for a cancelled booking is admitted-refused on
 * status rather than waved through.
 */
export const POST = route(async (request: NextRequest) => {
  await requireStaff();
  const input = body.parse(await request.json());
  const settings = await getSettings();

  let ref: string;

  if (input.token) {
    const verification = await verifyPassToken(input.token.trim());
    if (!verification.valid) {
      const reason =
        verification.reason === 'bad_signature'
          ? 'This pass has been altered or was not issued by us. Do not admit.'
          : verification.reason === 'unknown'
            ? 'No booking matches this pass.'
            : 'That QR is not a Pickle Lounge pass.';
      return NextResponse.json({ outcome: 'invalid', reason });
    }
    ref = verification.booking.ref;
  } else {
    ref = normaliseRef(input.ref!);
    if (!/^PL-[A-Z0-9]{6}$/.test(ref)) {
      throw new ValidationError('A reference looks like PL-K7Q2M9.');
    }
  }

  const booking = await findByRefWithParty(ref);
  if (!booking) {
    return NextResponse.json({ outcome: 'not_found', reason: `No booking for ${ref}.`, ref });
  }

  const paidPayment = booking.payments.find((p) => p.status === 'PAID');
  const now = new Date();

  const admissible =
    booking.status === 'CONFIRMED' && booking.endsAt > now
      ? 'admit'
      : booking.status === 'CONFIRMED'
        ? 'expired'
        : 'refuse';

  if (admissible === 'admit' && !booking.scannedAt) {
    await prisma.booking.update({ where: { id: booking.id }, data: { scannedAt: now } });
  }

  return NextResponse.json({
    outcome: admissible,
    ref: booking.ref,
    status: booking.status,
    court: `Court ${booking.court.code} · ${booking.court.name}`,
    slot: slotLabel(booking.startsAt, booking.endsAt, settings.timezone),
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    total: formatPeso(booking.totalCents),
    paid: Boolean(paidPayment),
    method: paidPayment?.method ? methodLabel(paidPayment.method) : null,
    booker: booking.customerName,
    mobile: booking.customerMobile,
    maxPlayers: settings.maxPlayers,
    players: booking.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBooker: p.isBooker,
      checkedIn: Boolean(p.checkedInAt),
    })),
  });
});
