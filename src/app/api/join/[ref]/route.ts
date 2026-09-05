import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { findByRefWithParty } from '@/lib/booking';
import { makePlayerToken } from '@/lib/pass';
import { route } from '@/lib/api';
import { NotFoundError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const body = z.object({
  name: z.string().trim().min(2, 'Please give your name.').max(120),
  contact: z.string().trim().max(60).optional().or(z.literal('')),
});

/** A player signs themselves onto the booker's party via the join link. */
export const POST = route(async (request: NextRequest, context: { params: Promise<{ ref: string }> }) => {
  const { ref } = await context.params;
  const input = body.parse(await request.json());

  const booking = await findByRefWithParty(ref);
  if (!booking) throw new NotFoundError('That join link is not valid.');
  if (booking.status !== 'CONFIRMED') {
    throw new ValidationError('That booking is not confirmed, so its roster is closed.');
  }
  if (booking.endsAt < new Date()) {
    throw new ValidationError('That booking has already finished.');
  }

  // No cap on the roster: a booker invites whoever they like, and the desk
  // sees everyone who signed up.
  const name = input.name.trim();
  if (booking.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new ValidationError('Somebody with that name is already on this roster.');
  }

  const player = await prisma.playerRegistration.create({
    data: { bookingId: booking.id, name, contact: input.contact?.trim() || null },
  });

  // The player leaves with their own pass rather than a promise that the
  // booker will turn up holding one.
  const passPath = `/pass/player/${encodeURIComponent(makePlayerToken(booking, player))}`;

  return NextResponse.json({ id: player.id, name: player.name, passPath }, { status: 201 });
});
