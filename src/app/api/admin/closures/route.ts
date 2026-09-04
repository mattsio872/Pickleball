import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { venueInstant, isDayKey, slotLabel } from '@/lib/time';
import { route } from '@/lib/api';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const create = z.object({
  /** Null closes every court. */
  courtId: z.string().min(1).nullable(),
  date: z.string().refine(isDayKey, 'Expected a date as YYYY-MM-DD'),
  startMinutes: z.number().int().min(0).max(24 * 60),
  endMinutes: z.number().int().min(0).max(24 * 60),
  reason: z.string().trim().min(2, 'Say what the closure is for.').max(140),
});

export const POST = route(async (request: NextRequest) => {
  await requireAdmin();
  const input = create.parse(await request.json());
  const settings = await getSettings();

  if (input.endMinutes <= input.startMinutes) {
    throw new ValidationError('A closure must end after it starts.');
  }

  const startsAt = venueInstant(input.date, input.startMinutes, settings.timezone);
  const endsAt = venueInstant(input.date, input.endMinutes, settings.timezone);

  // Closing over paid bookings would leave parties turning up to a shut court.
  const affected = await prisma.booking.findMany({
    where: {
      status: 'CONFIRMED',
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(input.courtId ? { courtId: input.courtId } : {}),
    },
    include: { court: true },
    take: 10,
  });

  if (affected.length > 0) {
    const list = affected
      .map((b) => `${b.ref} (Court ${b.court.code}, ${slotLabel(b.startsAt, b.endsAt, settings.timezone)})`)
      .join('; ');
    throw new ValidationError(
      `That window already has ${affected.length} confirmed booking${affected.length === 1 ? '' : 's'}: ${list}. ` +
        'Cancel and refund those first.',
    );
  }

  const closure = await prisma.closure.create({
    data: { courtId: input.courtId, startsAt, endsAt, reason: input.reason },
  });
  return NextResponse.json(closure, { status: 201 });
});

export const DELETE = route(async (request: NextRequest) => {
  await requireAdmin();
  const id = request.nextUrl.searchParams.get('id');
  if (!id) throw new ValidationError('Which closure?');
  await prisma.closure.delete({ where: { id } });
  return NextResponse.json({ ok: true });
});
