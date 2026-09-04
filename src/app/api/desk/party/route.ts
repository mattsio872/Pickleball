import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { findByRefWithParty } from '@/lib/booking';
import { getSettings } from '@/lib/settings';
import { route } from '@/lib/api';
import { NotFoundError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  ref: z.string().min(1),
  name: z.string().trim().min(2, 'Give the walk-on player a name.').max(120),
});

/** Add a walk-on player at the desk, up to the party limit. */
export const POST = route(async (request: NextRequest) => {
  await requireStaff();
  const input = body.parse(await request.json());

  const booking = await findByRefWithParty(input.ref);
  if (!booking) throw new NotFoundError('No booking for that reference.');
  if (booking.status !== 'CONFIRMED') {
    throw new ValidationError('That booking is not confirmed.');
  }

  const settings = await getSettings();
  if (booking.players.length >= settings.maxPlayers) {
    throw new ValidationError(`This party is already at the ${settings.maxPlayers}-player limit.`);
  }

  const player = await prisma.playerRegistration.create({
    data: { bookingId: booking.id, name: input.name.trim(), checkedInAt: new Date() },
  });

  return NextResponse.json({ id: player.id, name: player.name, checkedIn: true }, { status: 201 });
});
