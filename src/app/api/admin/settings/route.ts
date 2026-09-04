import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { route } from '@/lib/api';
import { ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  venueName: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(60),
  hourlyRateCents: z.number().int().min(0).max(100_000_00),
  openHour: z.number().int().min(0).max(23),
  closeHour: z.number().int().min(1).max(24),
  durationsMinutes: z.array(z.number().int().min(30).max(480)).min(1).max(8),
  maxPlayers: z.number().int().min(1).max(20),
  holdMinutes: z.number().int().min(2).max(120),
  cancellationHours: z.number().int().min(0).max(168),
  contactViber: z.string().trim().max(40),
});

export const PUT = route(async (request: NextRequest) => {
  await requireAdmin();
  const input = body.parse(await request.json());

  if (input.closeHour <= input.openHour) {
    throw new ValidationError('Closing time must be later than opening time.');
  }
  const shortest = Math.min(...input.durationsMinutes);
  if (input.openHour * 60 + shortest > input.closeHour * 60) {
    throw new ValidationError('The shortest bookable block does not fit inside the opening hours.');
  }
  // Timezone identifiers reach date-fns-tz, which throws on an unknown zone —
  // better to reject it here than to break every date on the site.
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone });
  } catch {
    throw new ValidationError(`"${input.timezone}" is not a recognised timezone.`);
  }

  const settings = await prisma.settings.update({
    where: { id: 1 },
    data: { ...input, durationsMinutes: [...input.durationsMinutes].sort((a, b) => a - b) },
  });
  return NextResponse.json(settings);
});
