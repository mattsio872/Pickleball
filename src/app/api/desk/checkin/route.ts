import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { route } from '@/lib/api';
import { NotFoundError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({ playerId: z.string().min(1), checkedIn: z.boolean() });

/** Toggle one player's check-in state on the desk roster. */
export const POST = route(async (request: NextRequest) => {
  await requireStaff();
  const input = body.parse(await request.json());

  const player = await prisma.playerRegistration.findUnique({
    where: { id: input.playerId },
    include: { booking: true },
  });
  if (!player) throw new NotFoundError('That player is not on any roster.');
  if (player.booking.status !== 'CONFIRMED') {
    throw new ValidationError('That booking is not confirmed, so nobody can be checked in against it.');
  }

  const updated = await prisma.playerRegistration.update({
    where: { id: input.playerId },
    data: { checkedInAt: input.checkedIn ? new Date() : null },
  });

  return NextResponse.json({ id: updated.id, checkedIn: Boolean(updated.checkedInAt) });
});
