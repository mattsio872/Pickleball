import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { deleteBooking, moveBooking, releaseBooking, restoreBooking } from '@/lib/booking-admin';
import { sendPassEmail } from '@/lib/email';
import { slotLabel, isDayKey, dayKeyOf, minutesIntoDayOf } from '@/lib/time';
import { normaliseRef } from '@/lib/booking';
import { route } from '@/lib/api';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Bookings, as the venue manages them.
 *
 * Front desk staff may look up, move and release bookings — that is the job.
 * Deleting a row outright is limited to admins, because it is the one action
 * here that destroys a record rather than changing one.
 */

async function serialise(bookingId: string) {
  const settings = await getSettings();
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { court: true, players: true, payments: true, customer: { select: { email: true } } },
  });
  const paid = booking.payments.find((p) => p.status === 'PAID');
  return {
    id: booking.id,
    ref: booking.ref,
    status: booking.status,
    courtId: booking.courtId,
    court: `Court ${booking.court.code} · ${booking.court.name}`,
    slot: slotLabel(booking.startsAt, booking.endsAt, settings.timezone),
    dayKey: dayKeyOf(booking.startsAt, settings.timezone),
    startMinutes: minutesIntoDayOf(booking.startsAt, settings.timezone),
    durationMinutes: Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000),
    totalCents: booking.totalCents,
    hourlyRateCents: booking.hourlyRateCents,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    customerMobile: booking.customerMobile,
    players: booking.players.length,
    paid: Boolean(paid),
    paidCents: paid?.amountCents ?? 0,
    hasAccount: Boolean(booking.customer),
    createdAt: booking.createdAt.toISOString(),
  };
}

/** Search by reference, name, email or mobile; or list a day. */
export const GET = route(async (request: NextRequest) => {
  await requireStaff();
  const params = request.nextUrl.searchParams;
  const query = params.get('q')?.trim();
  const day = params.get('date');
  const settings = await getSettings();

  const where = query
    ? {
        OR: [
          { ref: { contains: normaliseRef(query), mode: 'insensitive' as const } },
          { customerName: { contains: query, mode: 'insensitive' as const } },
          { customerEmail: { contains: query, mode: 'insensitive' as const } },
          { customerMobile: { contains: query } },
        ],
      }
    : day && isDayKey(day)
      ? {
          startsAt: { gte: new Date(`${day}T00:00:00Z`) },
          endsAt: { lte: new Date(`${day}T23:59:59Z`) },
        }
      : { endsAt: { gt: new Date() } };

  const bookings = await prisma.booking.findMany({
    where,
    include: { court: true, players: true, payments: true },
    orderBy: { startsAt: 'asc' },
    take: 100,
  });

  return NextResponse.json({
    bookings: await Promise.all(bookings.map((b) => serialise(b.id))),
    courts: await prisma.court.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, name: true },
    }),
    settings: {
      timezone: settings.timezone,
      openHour: settings.openHour,
      closeHour: settings.closeHour,
      durationsMinutes: settings.durationsMinutes,
    },
  });
});

const move = z.object({
  bookingId: z.string().min(1),
  courtId: z.string().min(1).optional(),
  date: z.string().refine(isDayKey, 'Expected a date as YYYY-MM-DD').optional(),
  startMinutes: z.number().int().min(0).max(24 * 60).optional(),
  durationMinutes: z.number().int().positive().optional(),
  customerName: z.string().trim().min(2).max(120).optional(),
  customerEmail: z.string().trim().email('That does not look like an email address.').max(200).optional(),
  customerMobile: z.string().trim().min(7).max(30).optional(),
  /** Re-send the pass so the party learns about the change. */
  notify: z.boolean().optional(),
});

export const PATCH = route(async (request: NextRequest) => {
  await requireStaff();
  const input = move.parse(await request.json());

  const result = await moveBooking({
    bookingId: input.bookingId,
    courtId: input.courtId,
    dayKey: input.date,
    startMinutes: input.startMinutes,
    durationMinutes: input.durationMinutes,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerMobile: input.customerMobile,
  });

  // Moving somebody's court or time without telling them is how a party turns
  // up to the wrong place, so the pass is re-sent by default when the slot moved.
  let emailed = false;
  if (result.slotChanged && input.notify !== false && result.booking.status === 'CONFIRMED') {
    const settings = await getSettings();
    const sent = await sendPassEmail({
      booking: result.booking,
      venueName: settings.venueName,
      city: settings.city,
      timezone: settings.timezone,
      contactViber: settings.contactViber,
    });
    emailed = sent.sent;
    if (sent.sent) {
      await prisma.booking.update({
        where: { id: result.booking.id },
        data: { passEmailedAt: new Date() },
      });
    }
  }

  return NextResponse.json({
    booking: await serialise(result.booking.id),
    slotChanged: result.slotChanged,
    priceChange: result.priceChange,
    emailed,
  });
});

const action = z.object({
  bookingId: z.string().min(1),
  action: z.enum(['release', 'restore']),
});

export const POST = route(async (request: NextRequest) => {
  await requireStaff();
  const input = action.parse(await request.json());

  if (input.action === 'release') {
    const result = await releaseBooking(input.bookingId);
    return NextResponse.json({
      booking: await serialise(result.booking.id),
      wasPaid: result.wasPaid,
      paidCents: result.paidCents,
    });
  }

  const booking = await restoreBooking(input.bookingId);
  return NextResponse.json({ booking: await serialise(booking.id) });
});

export const DELETE = route(async (request: NextRequest) => {
  // Deleting destroys a record rather than changing one, so it is the admin's
  // call, not the front desk's.
  await requireAdmin();
  const id = request.nextUrl.searchParams.get('id');
  if (!id) throw new ValidationError('Which booking?');
  const force = request.nextUrl.searchParams.get('force') === 'true';

  const result = await deleteBooking({ bookingId: id, force });
  return NextResponse.json({ ok: true, ...result });
});
